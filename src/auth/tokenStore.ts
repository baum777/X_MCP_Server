import type { Env } from "../config/env.js";
import type { Logger } from "../lib/logger.js";
import { hashIdentifier } from "./sessionCrypto.js";
import { parseSessionEncryptionKey } from "./sessionCrypto.js";
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
import { PostgresTokenStore } from "./postgresTokenStore.js";

export type {
  CreateSessionInput,
  OAuthSessionStore,
  PendingOauth,
  SessionStoreCleanupResult,
  TokenSession,
  UpdateSessionInput
} from "./sessionTypes.js";

export type SessionStoreMode = "in_memory" | "postgres";

export function createSessionStore(env: Env, logger: Logger): OAuthSessionStore {
  const encryptionKey = parseSessionEncryptionKey(env.sessionEncryptionKey);
  if (env.sessionStoreMode === "postgres") {
    return new PostgresTokenStore(env.databaseUrl, encryptionKey, logger);
  }
  logger.info({ session_store_mode: "in_memory" }, "Using in-memory session store");
  return new InMemoryTokenStore(encryptionKey);
}

export class InMemoryTokenStore implements OAuthSessionStore {
  private readonly sessions = new Map<string, ReturnType<typeof encodeSessionRow>>();
  private readonly pending = new Map<string, ReturnType<typeof encodePendingAuthRow>>();

  constructor(private readonly encryptionKey: Buffer) {}

  async initialize(): Promise<void> {
    return;
  }

  async putPendingAuth(pending: PendingOauth): Promise<void> {
    const row = encodePendingAuthRow(hashIdentifier(pending.state), pending, this.encryptionKey);
    this.pending.set(row.state_hash, row);
  }

  async consumePendingAuth(state: string): Promise<PendingOauth | null> {
    const stateHash = hashIdentifier(state);
    const row = this.pending.get(stateHash);
    if (!row) {
      return null;
    }
    if (row.expires_at_unix <= nowUnix()) {
      this.pending.delete(stateHash);
      return null;
    }
    this.pending.delete(stateHash);
    return decodePendingAuthRow(row, state, this.encryptionKey);
  }

  async createSession(input: CreateSessionInput): Promise<TokenSession> {
    const row = encodeSessionRow(
      {
        ...input,
        createdAtUnix: input.createdAtUnix ?? nowUnix(),
        updatedAtUnix: input.updatedAtUnix ?? nowUnix(),
        lastUsedAtUnix: input.lastUsedAtUnix ?? nowUnix(),
        status: input.status ?? "active"
      },
      this.encryptionKey
    );
    this.sessions.set(row.session_id, row);
    return decodeSessionRow(row, this.encryptionKey);
  }

  async getSession(sessionId: string): Promise<TokenSession | null> {
    const row = this.sessions.get(sessionId);
    if (!row) {
      return null;
    }
    if (row.status !== "active") {
      return null;
    }
    if (row.expires_at_unix !== null && row.expires_at_unix <= nowUnix()) {
      this.sessions.set(sessionId, {
        ...row,
        status: "expired",
        updated_at_unix: nowUnix()
      });
      return null;
    }
    return decodeSessionRow(row, this.encryptionKey);
  }

  async updateSession(sessionId: string, input: UpdateSessionInput): Promise<TokenSession | null> {
    const row = this.sessions.get(sessionId);
    if (!row || row.status !== "active") {
      return null;
    }
    if (row.expires_at_unix !== null && row.expires_at_unix <= nowUnix()) {
      this.sessions.set(sessionId, {
        ...row,
        status: "expired",
        updated_at_unix: nowUnix()
      });
      return null;
    }
    const current = decodeSessionRow(row, this.encryptionKey);
    const merged = mergeSessionPatch(current, input, nowUnix());
    const nextRow = encodeSessionRow(
      {
        ...merged,
        createdAtUnix: current.createdAtUnix,
        updatedAtUnix: merged.updatedAtUnix,
        lastUsedAtUnix: merged.lastUsedAtUnix,
        status: merged.status
      },
      this.encryptionKey
    );
    this.sessions.set(sessionId, nextRow);
    return decodeSessionRow(nextRow, this.encryptionKey);
  }

  async touchSession(sessionId: string): Promise<TokenSession | null> {
    const row = this.sessions.get(sessionId);
    if (!row || row.status !== "active") {
      return null;
    }
    if (row.expires_at_unix !== null && row.expires_at_unix <= nowUnix()) {
      this.sessions.set(sessionId, {
        ...row,
        status: "expired",
        updated_at_unix: nowUnix()
      });
      return null;
    }
    const nextRow = {
      ...row,
      last_used_at_unix: nowUnix(),
      updated_at_unix: nowUnix()
    };
    this.sessions.set(sessionId, nextRow);
    return decodeSessionRow(nextRow, this.encryptionKey);
  }

  async revokeSession(sessionId: string): Promise<TokenSession | null> {
    const row = this.sessions.get(sessionId);
    if (!row) {
      return null;
    }
    const nextRow = {
      ...row,
      status: "revoked" as const,
      updated_at_unix: nowUnix(),
      last_used_at_unix: nowUnix()
    };
    this.sessions.set(sessionId, nextRow);
    return decodeSessionRow(nextRow, this.encryptionKey);
  }

  async deleteExpiredSessions(now = nowUnix()): Promise<SessionStoreCleanupResult> {
    let deletedSessions = 0;
    for (const [sessionId, row] of this.sessions.entries()) {
      if (row.status !== "active" || (row.expires_at_unix !== null && row.expires_at_unix <= now)) {
        this.sessions.delete(sessionId);
        deletedSessions += 1;
      }
    }

    let deletedPendingAuth = 0;
    for (const [stateHash, row] of this.pending.entries()) {
      if (row.expires_at_unix <= now) {
        this.pending.delete(stateHash);
        deletedPendingAuth += 1;
      }
    }

    return { deletedSessions, deletedPendingAuth };
  }
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
