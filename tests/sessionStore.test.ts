import { describe, expect, it } from "vitest";
import { InMemoryTokenStore } from "../src/auth/tokenStore.js";
import { parseSessionEncryptionKey } from "../src/auth/sessionCrypto.js";
import { decodePendingAuthRow, decodeSessionRow, encodePendingAuthRow, encodeSessionRow } from "../src/auth/sessionSerialization.js";

const ENCRYPTION_KEY = parseSessionEncryptionKey(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
);

function makeSession(overrides: Partial<Parameters<typeof encodeSessionRow>[0]> = {}) {
  return {
    sessionId: "session-1",
    accessToken: "access-token-secret",
    refreshToken: "refresh-token-secret",
    scope: ["tweet.read", "users.read"],
    expiresAtUnix: Math.floor(Date.now() / 1000) + 3600,
    linkedAccount: { id: "123", username: "linked-user" },
    createdAtUnix: 1000,
    updatedAtUnix: 1000,
    lastUsedAtUnix: 1000,
    status: "active" as const,
    ...overrides
  };
}

describe("session store layer", () => {
  it("round-trips encrypted session rows without plaintext token material", () => {
    const row = encodeSessionRow(makeSession(), ENCRYPTION_KEY);

    expect(row.access_token_ciphertext).not.toContain("access-token-secret");
    expect(row.refresh_token_ciphertext).not.toContain("refresh-token-secret");
    expect(JSON.stringify(row)).not.toContain("access-token-secret");
    expect(JSON.stringify(row)).not.toContain("refresh-token-secret");

    const decoded = decodeSessionRow(row, ENCRYPTION_KEY);
    expect(decoded.accessToken).toBe("access-token-secret");
    expect(decoded.refreshToken).toBe("refresh-token-secret");
    expect(decoded.linkedAccount).toEqual({ id: "123", username: "linked-user" });
  });

  it("rejects expired sessions and removes them during cleanup", async () => {
    const store = new InMemoryTokenStore(ENCRYPTION_KEY);
    await store.createSession(
      makeSession({
        sessionId: "expired-session",
        expiresAtUnix: Math.floor(Date.now() / 1000) - 1
      })
    );

    expect(await store.getSession("expired-session")).toBeNull();
    const cleanup = await store.deleteExpiredSessions();
    expect(cleanup.deletedSessions).toBe(1);
    expect(await store.getSession("expired-session")).toBeNull();
  });

  it("rejects revoked sessions", async () => {
    const store = new InMemoryTokenStore(ENCRYPTION_KEY);
    await store.createSession(makeSession({ sessionId: "revoked-session" }));

    const revoked = await store.revokeSession("revoked-session");
    expect(revoked?.status).toBe("revoked");
    expect(await store.getSession("revoked-session")).toBeNull();

    const cleanup = await store.deleteExpiredSessions();
    expect(cleanup.deletedSessions).toBe(1);
  });

  it("persists linked account updates and touch semantics", async () => {
    const store = new InMemoryTokenStore(ENCRYPTION_KEY);
    const created = await store.createSession(
      makeSession({
        sessionId: "touch-session",
        linkedAccount: { id: null, username: null }
      })
    );

    const touched = await store.touchSession("touch-session");
    expect(touched?.lastUsedAtUnix).toBeGreaterThanOrEqual(created.lastUsedAtUnix);
    expect(touched?.createdAtUnix).toBe(created.createdAtUnix);

    const updated = await store.updateSession("touch-session", {
      linkedAccount: { id: "999", username: "hydrated-user" }
    });
    expect(updated?.createdAtUnix).toBe(created.createdAtUnix);
    expect(updated?.linkedAccount).toEqual({ id: "999", username: "hydrated-user" });

    const reloaded = await store.getSession("touch-session");
    expect(reloaded?.linkedAccount).toEqual({ id: "999", username: "hydrated-user" });
  });

  it("stores and consumes pending auth durably", async () => {
    const store = new InMemoryTokenStore(ENCRYPTION_KEY);
    const pending = {
      state: "oauth-state",
      codeVerifier: "pkce-secret",
      createdAtUnix: 1000,
      expiresAtUnix: Math.floor(Date.now() / 1000) + 600,
      status: "active" as const
    };

    const row = encodePendingAuthRow("statehash", pending, ENCRYPTION_KEY);
    expect(JSON.stringify(row)).not.toContain("pkce-secret");
    expect(decodePendingAuthRow(row, pending.state, ENCRYPTION_KEY).codeVerifier).toBe("pkce-secret");

    await store.putPendingAuth(pending);
    await expect(store.consumePendingAuth(pending.state)).resolves.toMatchObject({
      state: pending.state,
      codeVerifier: "pkce-secret"
    });
    expect(await store.consumePendingAuth(pending.state)).toBeNull();
  });

  it("cleans up expired pending auth rows", async () => {
    const store = new InMemoryTokenStore(ENCRYPTION_KEY);
    await store.putPendingAuth({
      state: "expired-state",
      codeVerifier: "expired-secret",
      createdAtUnix: 1000,
      expiresAtUnix: Math.floor(Date.now() / 1000) - 1,
      status: "active"
    });

    const cleanup = await store.deleteExpiredSessions();
    expect(cleanup.deletedPendingAuth).toBe(1);
    expect(await store.consumePendingAuth("expired-state")).toBeNull();
  });
});
