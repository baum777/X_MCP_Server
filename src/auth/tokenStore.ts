import { randomUUID } from "node:crypto";

export type LinkedAccount = {
  id: string | null;
  username: string | null;
};

export type TokenSession = {
  sessionId: string;
  accessToken: string;
  refreshToken: string | null;
  scope: string[];
  expiresAtUnix: number | null;
  linkedAccount: LinkedAccount;
  createdAtUnix: number;
  updatedAtUnix: number;
};

export type PendingOauth = {
  state: string;
  codeVerifier: string;
  createdAtUnix: number;
};

export class InMemoryTokenStore {
  private readonly sessions = new Map<string, TokenSession>();
  private readonly pending = new Map<string, PendingOauth>();

  constructor(private readonly sessionTtlSeconds: number) {}

  putPendingAuth(pending: PendingOauth): void {
    this.pending.set(pending.state, pending);
  }

  consumePendingAuth(state: string): PendingOauth | null {
    const pending = this.pending.get(state) ?? null;
    if (pending) {
      this.pending.delete(state);
    }
    return pending;
  }

  createOrUpdateSession(input: Omit<TokenSession, "sessionId" | "createdAtUnix" | "updatedAtUnix"> & { sessionId?: string }) {
    const now = nowUnix();
    const sessionId = input.sessionId ?? randomUUID();
    const existing = this.sessions.get(sessionId);
    const next: TokenSession = {
      sessionId,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      scope: input.scope,
      expiresAtUnix: input.expiresAtUnix,
      linkedAccount: input.linkedAccount,
      createdAtUnix: existing?.createdAtUnix ?? now,
      updatedAtUnix: now
    };
    this.sessions.set(sessionId, next);
    return next;
  }

  getSession(sessionId: string): TokenSession | null {
    const session = this.sessions.get(sessionId) ?? null;
    if (!session) {
      return null;
    }
    if (session.updatedAtUnix + this.sessionTtlSeconds < nowUnix()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
