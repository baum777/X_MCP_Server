import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XOAuthService } from "../src/auth/oauth.js";
import { parseSessionEncryptionKey } from "../src/auth/sessionCrypto.js";
import { InMemoryTokenStore } from "../src/auth/tokenStore.js";
import type { Env } from "../src/config/env.js";

const ENCRYPTION_KEY = parseSessionEncryptionKey(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
);

function makeEnv(xClientSecret: string | null): Env {
  return {
    port: 3000,
    publicBaseUrl: "https://example.com",
    mcpBasePath: "/mcp",
    logLevel: "info",
    xClientId: "client-id",
    xClientSecret,
    xRedirectUri: "https://example.com/oauth/x/callback",
    xScopes: ["tweet.read", "users.read", "offline.access"],
    xAuthorizeUrl: "https://x.com/i/oauth2/authorize",
    xTokenUrl: "https://api.x.com/2/oauth2/token",
    xIssuer: "https://api.x.com",
    xAudience: "api.x.com",
    xJwksUrl: null,
    xAppBearerToken: null,
    sessionStoreMode: "in_memory",
    sessionEncryptionKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    databaseUrl: null,
    oauthPendingAuthTtlSeconds: 600,
    xTokenVerificationMode: "opaque_trust_session",
    tokenSessionTtlSeconds: 86400
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn()
  };
}

function bodyToObject(body: unknown): Record<string, string> {
  if (body instanceof URLSearchParams) {
    return Object.fromEntries(body.entries());
  }
  return Object.fromEntries(new URLSearchParams(String(body)).entries());
}

describe("X OAuth token exchange", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses Basic auth for confidential clients and omits client_id from the body", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          scope: "tweet.read users.read offline.access",
          expires_in: 3600
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const store = new InMemoryTokenStore(ENCRYPTION_KEY);
    const logger = makeLogger();
    const service = new XOAuthService(makeEnv("client-secret"), store, logger as never);
    const flow = await service.buildAuthorizeRedirectUrl();

    await service.exchangeCodeForSession({ code: "auth-code", state: flow.state });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.x.com/2/oauth2/token");
    expect(init?.method).toBe("POST");

    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization ?? headers.Authorization).toBe(
      `Basic ${Buffer.from("client-id:client-secret", "utf8").toString("base64")}`
    );

    const body = bodyToObject(init?.body);
    expect(body).toMatchObject({
      grant_type: "authorization_code",
      code: "auth-code",
      redirect_uri: "https://example.com/oauth/x/callback"
    });
    expect(body.code_verifier).toBeDefined();
    expect(body.client_id).toBeUndefined();
    expect(body.client_secret).toBeUndefined();
  });

  it("sends client_id in the body for public clients and omits the Basic header", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          scope: "tweet.read users.read offline.access",
          expires_in: 3600
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const store = new InMemoryTokenStore(ENCRYPTION_KEY);
    const logger = makeLogger();
    const service = new XOAuthService(makeEnv(null), store, logger as never);
    const flow = await service.buildAuthorizeRedirectUrl();

    await service.exchangeCodeForSession({ code: "auth-code", state: flow.state });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [_, init] = fetchMock.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization ?? headers.Authorization).toBeUndefined();

    const body = bodyToObject(init?.body);
    expect(body).toMatchObject({
      grant_type: "authorization_code",
      code: "auth-code",
      redirect_uri: "https://example.com/oauth/x/callback",
      client_id: "client-id"
    });
    expect(body.code_verifier).toBeDefined();
    expect(body.client_secret).toBeUndefined();
  });

  it("does not log credentials when X rejects the token exchange", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "unauthorized_client",
          error_description: "Missing valid authorization header"
        }),
        {
          status: 400,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const store = new InMemoryTokenStore(ENCRYPTION_KEY);
    const logger = makeLogger();
    const service = new XOAuthService(makeEnv("client-secret"), store, logger as never);
    const flow = await service.buildAuthorizeRedirectUrl();

    await expect(service.exchangeCodeForSession({ code: "auth-code", state: flow.state })).rejects.toMatchObject({
      code: "UPSTREAM_AUTH_ERROR",
      details: {
        payload: {
          error: "unauthorized_client",
          error_description: "Missing valid authorization header"
        }
      }
    });

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.trace).not.toHaveBeenCalled();
  });
});
