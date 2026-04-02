import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  jwtVerify: vi.fn(async () => undefined),
  createRemoteJWKSet: vi.fn(() => ({ mocked: true }))
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: mocks.createRemoteJWKSet,
  jwtVerify: mocks.jwtVerify
}));

import { OAuthTokenVerifier } from "../src/auth/tokenVerifier.js";

function makeEnv(mode: "strict_jwt" | "opaque_trust_session" | "dev_skip_verify", jwksUrl?: string) {
  return {
    port: 3000,
    publicBaseUrl: "https://example.com",
    mcpBasePath: "/mcp",
    logLevel: "info" as const,
    xClientId: "client",
    xClientSecret: null,
    xRedirectUri: "https://example.com/oauth/x/callback",
    xScopes: ["tweet.read", "users.read", "offline.access"],
    xAuthorizeUrl: "https://twitter.com/i/oauth2/authorize",
    xTokenUrl: "https://api.x.com/2/oauth2/token",
    xIssuer: "https://api.x.com",
    xAudience: "api.x.com",
    xJwksUrl: jwksUrl ?? null,
    xAppBearerToken: null,
    sessionStoreMode: "in_memory" as const,
    sessionEncryptionKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    databaseUrl: null,
    oauthPendingAuthTtlSeconds: 600,
    xTokenVerificationMode: mode,
    tokenSessionTtlSeconds: 86400
  };
}

function makeSession(accessToken: string) {
    return {
      sessionId: "session-1",
      accessToken,
      refreshToken: null,
      scope: ["tweet.read", "users.read", "offline.access"],
      expiresAtUnix: Math.floor(Date.now() / 1000) + 3600,
      linkedAccount: { id: "123", username: "bob" },
      createdAtUnix: 1,
      updatedAtUnix: 1,
      lastUsedAtUnix: 1,
      status: "active" as const
    };
  }

describe("OAuthTokenVerifier modes", () => {
  beforeEach(() => {
    mocks.jwtVerify.mockClear();
    mocks.createRemoteJWKSet.mockClear();
  });

  it("fails closed for opaque tokens in strict_jwt mode", async () => {
    const verifier = new OAuthTokenVerifier(makeEnv("strict_jwt"));
    await expect(
      verifier.verify(makeSession("opaque-token"), { requiredScopes: ["tweet.read"] })
    ).rejects.toMatchObject({
      code: "AUTH_TOKEN_UNVERIFIABLE"
    });
    expect(mocks.jwtVerify).not.toHaveBeenCalled();
  });

  it("trusts session-bound opaque tokens in opaque_trust_session mode", async () => {
    const verifier = new OAuthTokenVerifier(makeEnv("opaque_trust_session"));
    await expect(
      verifier.verify(makeSession("opaque-token"), { requiredScopes: ["tweet.read"] })
    ).resolves.toBeUndefined();
    expect(mocks.jwtVerify).not.toHaveBeenCalled();
  });

  it("verifies JWTs in strict_jwt mode when JWKS is configured", async () => {
    const verifier = new OAuthTokenVerifier(makeEnv("strict_jwt", "https://example.com/jwks.json"));
    await expect(
      verifier.verify(makeSession("header.payload.signature"), { requiredScopes: ["tweet.read"] })
    ).resolves.toBeUndefined();
    expect(mocks.createRemoteJWKSet).toHaveBeenCalledTimes(1);
    expect(mocks.jwtVerify).toHaveBeenCalledTimes(1);
  });

  it("skips claim verification in dev_skip_verify mode", async () => {
    const verifier = new OAuthTokenVerifier(makeEnv("dev_skip_verify"));
    await expect(
      verifier.verify(makeSession("opaque-token"), { requiredScopes: ["tweet.read"] })
    ).resolves.toBeUndefined();
    expect(mocks.jwtVerify).not.toHaveBeenCalled();
  });
});
