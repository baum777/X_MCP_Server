import { AppError } from "../lib/errors.js";
import { decryptSecret, encryptSecret } from "./sessionCrypto.js";
import type { CreateSessionInput, PendingOauth, TokenSession, UpdateSessionInput } from "./sessionTypes.js";

export type StoredSessionRow = {
  session_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  scope: string[];
  expires_at_unix: number | null;
  linked_account_id: string | null;
  linked_account_username: string | null;
  created_at_unix: number;
  updated_at_unix: number;
  last_used_at_unix: number;
  status: TokenSession["status"];
};

export type StoredPendingAuthRow = {
  state_hash: string;
  code_verifier_ciphertext: string;
  created_at_unix: number;
  expires_at_unix: number;
};

export function encodeSessionRow(
  input: CreateSessionInput | (TokenSession & { createdAtUnix?: number; updatedAtUnix?: number; lastUsedAtUnix?: number }),
  key: Buffer
): StoredSessionRow {
  const createdAtUnix = input.createdAtUnix ?? nowUnix();
  const updatedAtUnix = input.updatedAtUnix ?? nowUnix();
  const lastUsedAtUnix = input.lastUsedAtUnix ?? updatedAtUnix;
  const status = resolveSessionStatus(input.status ?? "active", input.expiresAtUnix);

  return {
    session_id: input.sessionId,
    access_token_ciphertext: encryptSecret(input.accessToken, key, `access:${input.sessionId}`),
    refresh_token_ciphertext: input.refreshToken ? encryptSecret(input.refreshToken, key, `refresh:${input.sessionId}`) : null,
    scope: [...input.scope],
    expires_at_unix: input.expiresAtUnix,
    linked_account_id: input.linkedAccount.id,
    linked_account_username: input.linkedAccount.username,
    created_at_unix: createdAtUnix,
    updated_at_unix: updatedAtUnix,
    last_used_at_unix: lastUsedAtUnix,
    status
  };
}

export function decodeSessionRow(row: StoredSessionRow, key: Buffer): TokenSession {
  const status = row.status;
  const expiresAtUnix = row.expires_at_unix;
  if (status !== "active") {
    return {
      sessionId: row.session_id,
      accessToken: decryptSecret(row.access_token_ciphertext, key, `access:${row.session_id}`),
      refreshToken: row.refresh_token_ciphertext
        ? decryptSecret(row.refresh_token_ciphertext, key, `refresh:${row.session_id}`)
        : null,
      scope: [...row.scope],
      expiresAtUnix,
      linkedAccount: {
        id: row.linked_account_id,
        username: row.linked_account_username
      },
      createdAtUnix: row.created_at_unix,
      updatedAtUnix: row.updated_at_unix,
      lastUsedAtUnix: row.last_used_at_unix,
      status
    };
  }

  return {
    sessionId: row.session_id,
    accessToken: decryptSecret(row.access_token_ciphertext, key, `access:${row.session_id}`),
    refreshToken: row.refresh_token_ciphertext ? decryptSecret(row.refresh_token_ciphertext, key, `refresh:${row.session_id}`) : null,
    scope: [...row.scope],
    expiresAtUnix,
    linkedAccount: {
      id: row.linked_account_id,
      username: row.linked_account_username
    },
    createdAtUnix: row.created_at_unix,
    updatedAtUnix: row.updated_at_unix,
    lastUsedAtUnix: row.last_used_at_unix,
    status
  };
}

export function encodePendingAuthRow(stateHash: string, pending: PendingOauth, key: Buffer): StoredPendingAuthRow {
  return {
    state_hash: stateHash,
    code_verifier_ciphertext: encryptSecret(pending.codeVerifier, key, `pending:${stateHash}`),
    created_at_unix: pending.createdAtUnix,
    expires_at_unix: pending.expiresAtUnix
  };
}

export function decodePendingAuthRow(row: StoredPendingAuthRow, state: string, key: Buffer): PendingOauth {
  return {
    state,
    codeVerifier: decryptSecret(row.code_verifier_ciphertext, key, `pending:${row.state_hash}`),
    createdAtUnix: row.created_at_unix,
    expiresAtUnix: row.expires_at_unix,
    status: "active"
  };
}

export function resolveSessionStatus(
  status: TokenSession["status"],
  expiresAtUnix: number | null,
  now: number = nowUnix()
): TokenSession["status"] {
  if (status !== "active") {
    return status;
  }
  if (expiresAtUnix !== null && expiresAtUnix <= now) {
    return "expired";
  }
  return "active";
}

export function mergeSessionPatch(current: TokenSession, patch: UpdateSessionInput, now: number = nowUnix()): TokenSession {
  const next: TokenSession = {
    ...current,
    accessToken: patch.accessToken ?? current.accessToken,
    refreshToken: patch.refreshToken ?? current.refreshToken,
    scope: patch.scope ?? current.scope,
    expiresAtUnix: patch.expiresAtUnix ?? current.expiresAtUnix,
    linkedAccount: patch.linkedAccount ?? current.linkedAccount,
    updatedAtUnix: now,
    lastUsedAtUnix: now,
    status: resolveSessionStatus(patch.status ?? current.status, patch.expiresAtUnix ?? current.expiresAtUnix, now)
  };
  return next;
}

export function shouldExpireSession(session: TokenSession, now: number = nowUnix()): boolean {
  return session.status === "active" && session.expiresAtUnix !== null && session.expiresAtUnix <= now;
}

export function shouldCleanupSession(session: TokenSession, now: number = nowUnix()): boolean {
  return session.status === "expired" || session.status === "invalid" || shouldExpireSession(session, now);
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
