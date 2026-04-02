import { Pool, type PoolClient } from "pg";
import type { Env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { hashIdentifier } from "./sessionCrypto.js";
import {
  decodePendingAuthRow,
  decodeSessionRow,
  encodePendingAuthRow,
  encodeSessionRow,
  mergeSessionPatch
} from "./sessionSerialization.js";
import type {
  CreateSessionInput,
  OAuthSessionStore,
  PendingOauth,
  SessionStoreCleanupResult,
  TokenSession,
  UpdateSessionInput
} from "./sessionTypes.js";

type SessionRowQuery = {
  session_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  scope: string[];
  expires_at_unix: string | number | null;
  linked_account_id: string | null;
  linked_account_username: string | null;
  created_at_unix: string | number;
  updated_at_unix: string | number;
  last_used_at_unix: string | number;
  status: TokenSession["status"];
};

type PendingAuthRowQuery = {
  state_hash: string;
  code_verifier_ciphertext: string;
  created_at_unix: string | number;
  expires_at_unix: string | number;
};

export class PostgresTokenStore implements OAuthSessionStore {
  private readonly pool: Pool;

  constructor(
    private readonly databaseUrl: string | null,
    private readonly encryptionKey: Buffer,
    private readonly logger: Logger
  ) {
    if (!databaseUrl) {
      throw new AppError("CONFIG_ERROR", "DATABASE_URL is required when SESSION_STORE_MODE=postgres.", 500, false);
    }
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async initialize(): Promise<void> {
    try {
      await this.pool.query("select 1");
      const result = await this.pool.query<{
        sessions_table: string | null;
        pending_table: string | null;
      }>(
        `
        select
          to_regclass('public.oauth_sessions') as sessions_table,
          to_regclass('public.oauth_pending_auth') as pending_table
        `
      );
      const row = result.rows[0];
      if (!row?.sessions_table || !row?.pending_table) {
        throw new AppError(
          "CONFIG_ERROR",
          "Session tables are missing. Apply sql/migrations/001_oauth_sessions.sql before starting the server.",
          500,
          false
        );
      }
      this.logger.info({ session_store_mode: "postgres" }, "Using Postgres session store");
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw this.wrapStorageError("initialize", error);
    }
  }

  async putPendingAuth(pending: PendingOauth): Promise<void> {
    try {
      const stateHash = hashIdentifier(pending.state);
      const row = encodePendingAuthRow(stateHash, pending, this.encryptionKey);
      await this.pool.query(
        `
        insert into oauth_pending_auth (
          state_hash,
          code_verifier_ciphertext,
          created_at_unix,
          expires_at_unix
        ) values ($1, $2, $3, $4)
        on conflict (state_hash) do update set
          code_verifier_ciphertext = excluded.code_verifier_ciphertext,
          created_at_unix = excluded.created_at_unix,
          expires_at_unix = excluded.expires_at_unix
        `,
        [row.state_hash, row.code_verifier_ciphertext, row.created_at_unix, row.expires_at_unix]
      );
    } catch (error) {
      throw this.wrapStorageError("putPendingAuth", error);
    }
  }

  async consumePendingAuth(state: string): Promise<PendingOauth | null> {
    const stateHash = hashIdentifier(state);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const row = await this.selectPendingAuthForUpdate(client, stateHash);
      if (!row) {
        await client.query("commit");
        return null;
      }
      if (this.isExpired(Number(row.expires_at_unix))) {
        await client.query("delete from oauth_pending_auth where state_hash = $1", [stateHash]);
        await client.query("commit");
        return null;
      }

      await client.query("delete from oauth_pending_auth where state_hash = $1", [stateHash]);
      await client.query("commit");
      return decodePendingAuthRow(
        {
          state_hash: row.state_hash,
          code_verifier_ciphertext: row.code_verifier_ciphertext,
          created_at_unix: Number(row.created_at_unix),
          expires_at_unix: Number(row.expires_at_unix)
        },
        state,
        this.encryptionKey
      );
    } catch (error) {
      await client.query("rollback");
      throw this.wrapStorageError("consumePendingAuth", error);
    } finally {
      client.release();
    }
  }

  async createSession(input: CreateSessionInput): Promise<TokenSession> {
    try {
      const now = nowUnix();
      const prepared = this.prepareSessionInput(input, now);
      const row = encodeSessionRow(prepared, this.encryptionKey);
      const result = await this.pool.query<SessionRowQuery>(
        `
        insert into oauth_sessions (
          session_id,
          access_token_ciphertext,
          refresh_token_ciphertext,
          scope,
          expires_at_unix,
          linked_account_id,
          linked_account_username,
          created_at_unix,
          updated_at_unix,
          last_used_at_unix,
          status
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        on conflict (session_id) do update set
          access_token_ciphertext = excluded.access_token_ciphertext,
          refresh_token_ciphertext = excluded.refresh_token_ciphertext,
          scope = excluded.scope,
          expires_at_unix = excluded.expires_at_unix,
          linked_account_id = excluded.linked_account_id,
          linked_account_username = excluded.linked_account_username,
          updated_at_unix = excluded.updated_at_unix,
          last_used_at_unix = excluded.last_used_at_unix,
          status = excluded.status
        returning *
        `,
        [
          row.session_id,
          row.access_token_ciphertext,
          row.refresh_token_ciphertext,
          row.scope,
          row.expires_at_unix,
          row.linked_account_id,
          row.linked_account_username,
          row.created_at_unix,
          row.updated_at_unix,
          row.last_used_at_unix,
          row.status
        ]
      );
      const returnedRow = result.rows[0];
      if (!returnedRow) {
        throw new AppError("STORAGE_ERROR", "Postgres session store did not return a created session row.", 500, false);
      }
      return this.mapSessionRow(returnedRow);
    } catch (error) {
      throw this.wrapStorageError("createSession", error);
    }
  }

  async getSession(sessionId: string): Promise<TokenSession | null> {
    try {
      const result = await this.pool.query<SessionRowQuery>("select * from oauth_sessions where session_id = $1", [sessionId]);
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      if (row.status !== "active") {
        return null;
      }
      if (this.isExpired(Number(row.expires_at_unix))) {
        await this.pool.query(
          `update oauth_sessions set status = 'expired', updated_at_unix = $2 where session_id = $1`,
          [sessionId, nowUnix()]
        );
        return null;
      }
      return this.mapSessionRow(row);
    } catch (error) {
      throw this.wrapStorageError("getSession", error);
    }
  }

  async updateSession(sessionId: string, input: UpdateSessionInput): Promise<TokenSession | null> {
    try {
      const current = await this.getRawSession(sessionId);
      if (!current) {
        return null;
      }
      if (current.status !== "active") {
        return null;
      }
      if (this.isExpired(Number(current.expires_at_unix))) {
        await this.pool.query(
          `update oauth_sessions set status = 'expired', updated_at_unix = $2 where session_id = $1`,
          [sessionId, nowUnix()]
        );
        return null;
      }
      const currentSession = this.mapSessionRow(current);
      const merged = mergeSessionPatch(currentSession, input, nowUnix());
      const row = encodeSessionRow(
        {
          ...merged,
          createdAtUnix: currentSession.createdAtUnix,
          updatedAtUnix: merged.updatedAtUnix,
          lastUsedAtUnix: merged.lastUsedAtUnix,
          status: merged.status
        },
        this.encryptionKey
      );
      const result = await this.pool.query<SessionRowQuery>(
        `
        update oauth_sessions set
          access_token_ciphertext = $2,
          refresh_token_ciphertext = $3,
          scope = $4,
          expires_at_unix = $5,
          linked_account_id = $6,
          linked_account_username = $7,
          updated_at_unix = $8,
          last_used_at_unix = $9,
          status = $10
        where session_id = $1
        returning *
        `,
        [
          sessionId,
          row.access_token_ciphertext,
          row.refresh_token_ciphertext,
          row.scope,
          row.expires_at_unix,
          row.linked_account_id,
          row.linked_account_username,
          row.updated_at_unix,
          row.last_used_at_unix,
          row.status
        ]
      );
      const returnedRow = result.rows[0];
      if (!returnedRow) {
        throw new AppError("STORAGE_ERROR", "Postgres session store did not return an updated session row.", 500, false);
      }
      return this.mapSessionRow(returnedRow);
    } catch (error) {
      throw this.wrapStorageError("updateSession", error);
    }
  }

  async touchSession(sessionId: string): Promise<TokenSession | null> {
    try {
      const current = await this.getRawSession(sessionId);
      if (!current) {
        return null;
      }
      if (current.status !== "active") {
        return null;
      }
      if (this.isExpired(Number(current.expires_at_unix))) {
        await this.pool.query(
          `update oauth_sessions set status = 'expired', updated_at_unix = $2 where session_id = $1`,
          [sessionId, nowUnix()]
        );
        return null;
      }
      const now = nowUnix();
      const result = await this.pool.query<SessionRowQuery>(
        `update oauth_sessions set last_used_at_unix = $2, updated_at_unix = $2 where session_id = $1 returning *`,
        [sessionId, now]
      );
      const returnedRow = result.rows[0];
      if (!returnedRow) {
        throw new AppError("STORAGE_ERROR", "Postgres session store did not return a touched session row.", 500, false);
      }
      return this.mapSessionRow(returnedRow);
    } catch (error) {
      throw this.wrapStorageError("touchSession", error);
    }
  }

  async revokeSession(sessionId: string): Promise<TokenSession | null> {
    try {
      const current = await this.getRawSession(sessionId);
      if (!current) {
        return null;
      }
      const now = nowUnix();
      const result = await this.pool.query<SessionRowQuery>(
        `
        update oauth_sessions set
          status = 'revoked',
          updated_at_unix = $2,
          last_used_at_unix = $2
        where session_id = $1
        returning *
        `,
        [sessionId, now]
      );
      const returnedRow = result.rows[0];
      if (!returnedRow) {
        throw new AppError("STORAGE_ERROR", "Postgres session store did not return a revoked session row.", 500, false);
      }
      return this.mapSessionRow(returnedRow);
    } catch (error) {
      throw this.wrapStorageError("revokeSession", error);
    }
  }

  async deleteExpiredSessions(now = nowUnix()): Promise<SessionStoreCleanupResult> {
    try {
      const sessionsResult = await this.pool.query(
        `
        delete from oauth_sessions
        where status in ('expired', 'invalid')
           or (status = 'active' and expires_at_unix is not null and expires_at_unix <= $1)
        `,
        [now]
      );
      const pendingResult = await this.pool.query(
        `
        delete from oauth_pending_auth
        where expires_at_unix <= $1
        `,
        [now]
      );
      return {
        deletedSessions: sessionsResult.rowCount ?? 0,
        deletedPendingAuth: pendingResult.rowCount ?? 0
      };
    } catch (error) {
      throw this.wrapStorageError("deleteExpiredSessions", error);
    }
  }

  private async selectPendingAuthForUpdate(client: PoolClient, stateHash: string): Promise<PendingAuthRowQuery | null> {
    const result = await client.query<PendingAuthRowQuery>(
      `select * from oauth_pending_auth where state_hash = $1 for update`,
      [stateHash]
    );
    return result.rows[0] ?? null;
  }

  private async getRawSession(sessionId: string): Promise<SessionRowQuery | null> {
    const result = await this.pool.query<SessionRowQuery>("select * from oauth_sessions where session_id = $1", [sessionId]);
    return result.rows[0] ?? null;
  }

  private prepareSessionInput(input: CreateSessionInput, now: number): CreateSessionInput {
    return {
      ...input,
      createdAtUnix: input.createdAtUnix ?? now,
      updatedAtUnix: input.updatedAtUnix ?? now,
      lastUsedAtUnix: input.lastUsedAtUnix ?? now,
      status: input.status ?? "active"
    };
  }

  private mapSessionRow(row: SessionRowQuery): TokenSession {
    return decodeSessionRow(
      {
        session_id: row.session_id,
        access_token_ciphertext: row.access_token_ciphertext,
        refresh_token_ciphertext: row.refresh_token_ciphertext,
        scope: row.scope,
        expires_at_unix: row.expires_at_unix === null ? null : Number(row.expires_at_unix),
        linked_account_id: row.linked_account_id,
        linked_account_username: row.linked_account_username,
        created_at_unix: Number(row.created_at_unix),
        updated_at_unix: Number(row.updated_at_unix),
        last_used_at_unix: Number(row.last_used_at_unix),
        status: row.status
      },
      this.encryptionKey
    );
  }

  private isExpired(expiresAtUnix: number | null): boolean {
    return expiresAtUnix !== null && expiresAtUnix <= nowUnix();
  }

  private wrapStorageError(operation: string, error: unknown): AppError {
    return new AppError("STORAGE_ERROR", `Postgres session store operation failed: ${operation}.`, 500, false, {
      reason: error instanceof Error ? error.message : "unknown"
    });
  }
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
