import { createHash } from "node:crypto";
import type { Env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { generatePkcePair, randomState } from "./pkce.js";
import type { InMemoryTokenStore, TokenSession } from "./tokenStore.js";

type OAuthTokenResponse = {
  token_type?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export class XOAuthService {
  constructor(
    private readonly env: Env,
    private readonly tokenStore: InMemoryTokenStore,
    private readonly logger: Logger
  ) {}

  buildAuthorizeRedirectUrl() {
    const state = randomState();
    const { verifier, challenge } = generatePkcePair();
    this.tokenStore.putPendingAuth({
      state,
      codeVerifier: verifier,
      createdAtUnix: nowUnix()
    });

    const url = new URL(this.env.xAuthorizeUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.env.xClientId);
    url.searchParams.set("redirect_uri", this.env.xRedirectUri);
    url.searchParams.set("scope", this.env.xScopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return { state, url: url.toString() };
  }

  async exchangeCodeForSession(params: { code: string; state: string }): Promise<TokenSession> {
    const pending = this.tokenStore.consumePendingAuth(params.state);
    if (!pending) {
      throw new AppError("AUTH_REQUIRED", "OAuth state is missing or has already been consumed.", 401, false);
    }

    const tokenPayload = await this.exchangeAuthorizationCode(params.code, pending.codeVerifier);
    const accessToken = tokenPayload.access_token;
    if (!accessToken) {
      throw new AppError("AUTH_TOKEN_INVALID", "OAuth token exchange did not return an access token.", 401, false);
    }

    const scopes = tokenPayload.scope?.split(" ").filter(Boolean) ?? [];
    const expiresAtUnix =
      typeof tokenPayload.expires_in === "number" && Number.isFinite(tokenPayload.expires_in)
        ? nowUnix() + tokenPayload.expires_in
        : null;

    const session = this.tokenStore.createOrUpdateSession({
      accessToken,
      refreshToken: tokenPayload.refresh_token ?? null,
      scope: scopes,
      expiresAtUnix,
      linkedAccount: {
        id: null,
        username: null
      }
    });

    this.logger.info(
      {
        event: "oauth_linked_session",
        session_id_hash: hashValue(session.sessionId),
        scopes
      },
      "OAuth session linked"
    );

    return session;
  }

  async tryRefreshSession(session: TokenSession): Promise<TokenSession> {
    if (!session.refreshToken) {
      return session;
    }
    const now = nowUnix();
    if (session.expiresAtUnix !== null && session.expiresAtUnix > now + 30) {
      return session;
    }

    const body = new URLSearchParams();
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", session.refreshToken);
    body.set("client_id", this.env.xClientId);
    if (this.env.xClientSecret) {
      body.set("client_secret", this.env.xClientSecret);
    }

    let response: Response;
    try {
      response = await fetch(this.env.xTokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body
      });
    } catch (error) {
      throw new AppError("NETWORK_ERROR", "Token refresh failed due to a network error.", 502, true, {
        reason: error instanceof Error ? error.message : "unknown"
      });
    }

    if (!response.ok) {
      const payload = await safeJson(response);
      throw new AppError("UPSTREAM_AUTH_ERROR", "Token refresh was rejected by X OAuth.", response.status, false, {
        payload
      });
    }

    const tokenPayload = (await response.json()) as OAuthTokenResponse;
    if (!tokenPayload.access_token) {
      throw new AppError("AUTH_TOKEN_INVALID", "Token refresh did not return an access token.", 401, false);
    }

    const refreshed = this.tokenStore.createOrUpdateSession({
      sessionId: session.sessionId,
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token ?? session.refreshToken,
      scope: tokenPayload.scope?.split(" ").filter(Boolean) ?? session.scope,
      expiresAtUnix:
        typeof tokenPayload.expires_in === "number" && Number.isFinite(tokenPayload.expires_in)
          ? nowUnix() + tokenPayload.expires_in
          : session.expiresAtUnix,
      linkedAccount: session.linkedAccount
    });
    return refreshed;
  }

  private async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", code);
    body.set("redirect_uri", this.env.xRedirectUri);
    body.set("code_verifier", codeVerifier);
    body.set("client_id", this.env.xClientId);
    if (this.env.xClientSecret) {
      body.set("client_secret", this.env.xClientSecret);
    }

    let response: Response;
    try {
      response = await fetch(this.env.xTokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body
      });
    } catch (error) {
      throw new AppError("NETWORK_ERROR", "OAuth token exchange failed due to a network error.", 502, true, {
        reason: error instanceof Error ? error.message : "unknown"
      });
    }

    if (!response.ok) {
      const payload = await safeJson(response);
      throw new AppError("UPSTREAM_AUTH_ERROR", "OAuth token exchange was rejected by X.", response.status, false, {
        payload
      });
    }
    return (await response.json()) as OAuthTokenResponse;
  }
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
