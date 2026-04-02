export type SessionStatus = "active" | "expired" | "revoked" | "invalid";

export type PendingAuthStatus = "active" | "consumed" | "expired" | "invalid";

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
  lastUsedAtUnix: number;
  status: SessionStatus;
};

export type PendingOauth = {
  state: string;
  codeVerifier: string;
  createdAtUnix: number;
  expiresAtUnix: number;
  status: PendingAuthStatus;
};

export type CreateSessionInput = Omit<
  TokenSession,
  "createdAtUnix" | "updatedAtUnix" | "lastUsedAtUnix" | "status"
> & {
  createdAtUnix?: number;
  updatedAtUnix?: number;
  lastUsedAtUnix?: number;
  status?: SessionStatus;
};

export type UpdateSessionInput = Partial<
  Pick<TokenSession, "accessToken" | "refreshToken" | "scope" | "expiresAtUnix" | "linkedAccount" | "status">
>;

export type SessionStoreCleanupResult = {
  deletedSessions: number;
  deletedPendingAuth: number;
};

export interface OAuthSessionStore {
  initialize(): Promise<void>;
  putPendingAuth(pending: PendingOauth): Promise<void>;
  consumePendingAuth(state: string): Promise<PendingOauth | null>;
  createSession(input: CreateSessionInput): Promise<TokenSession>;
  getSession(sessionId: string): Promise<TokenSession | null>;
  updateSession(sessionId: string, input: UpdateSessionInput): Promise<TokenSession | null>;
  touchSession(sessionId: string): Promise<TokenSession | null>;
  revokeSession(sessionId: string): Promise<TokenSession | null>;
  deleteExpiredSessions(nowUnix?: number): Promise<SessionStoreCleanupResult>;
}
