import { createHash, randomUUID } from "node:crypto";
import type { Env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { generatePkcePair, randomState } from "./pkce.js";
import type { OAuthSessionStore, TokenSession } from "./sessionTypes.js";

type OAuthTokenResponse = {
  token_type?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

type TokenRequestKind = "authorization_code" | "refresh_token";

export class XOAuthService {
  constructor(
    private readonly env: Env,
    private readonly tokenStore: OAuthSessionStore,
    private readonly logger: Logger
  ) {}

  async buildAuthorizeRedirectUrl() {
    const now = nowUnix();
    const state = randomState();
    const { verifier, challenge } = generatePkcePair();
    await this.tokenStore.putPendingAuth({
      state,
      codeVerifier: verifier,
      createdAtUnix: now,
      expiresAtUnix: now + this.env.oauthPendingAuthTtlSeconds,
      status: "active"
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
    const pending = await this.tokenStore.consumePendingAuth(params.state);
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

    const session = await this.tokenStore.createSession({
      sessionId: randomSessionId(),
      accessToken,
      refreshToken: tokenPayload.refresh_token ?? null,
      scope: scopes,
      expiresAtUnix,
      linkedAccount: {
        id: null,
        username: null
      },
      createdAtUnix: nowUnix(),
      updatedAtUnix: nowUnix(),
      lastUsedAtUnix: nowUnix(),
      status: "active"
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

    const tokenPayload = await this.requestToken({
      grantType: "refresh_token",
      refreshToken: session.refreshToken
    });
    if (!tokenPayload.access_token) {
      await this.tokenStore.updateSession(session.sessionId, { status: "invalid" });
      throw new AppError("AUTH_TOKEN_INVALID", "Token refresh did not return an access token.", 401, false);
    }

    const refreshed = await this.tokenStore.updateSession(session.sessionId, {
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token ?? session.refreshToken,
      scope: tokenPayload.scope?.split(" ").filter(Boolean) ?? session.scope,
      expiresAtUnix:
        typeof tokenPayload.expires_in === "number" && Number.isFinite(tokenPayload.expires_in)
          ? nowUnix() + tokenPayload.expires_in
          : session.expiresAtUnix,
      linkedAccount: session.linkedAccount
    });
    if (!refreshed) {
      throw new AppError("STORAGE_ERROR", "Session refresh could not be persisted.", 500, false);
    }
    return refreshed;
  }

  private async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<OAuthTokenResponse> {
    return this.requestToken({
      grantType: "authorization_code",
      code,
      codeVerifier
    });
  }

  private async requestToken(request: {
    grantType: TokenRequestKind;
    code?: string;
    codeVerifier?: string;
    refreshToken?: string;
  }): Promise<OAuthTokenResponse> {
    const { headers, body } = this.buildTokenRequest(request);

    let response: Response;
    try {
      response = await fetch(this.env.xTokenUrl, {
        method: "POST",
        headers,
        body
      });
    } catch (error) {
      const failure =
        request.grantType === "refresh_token"
          ? "Token refresh failed due to a network error."
          : "OAuth token exchange failed due to a network error.";
      throw new AppError("NETWORK_ERROR", failure, 502, true, {
        reason: error instanceof Error ? error.message : "unknown"
      });
    }

    if (!response.ok) {
      const payload = await safeJson(response);
      const failure =
        request.grantType === "refresh_token"
          ? "Token refresh was rejected by X OAuth."
          : "OAuth token exchange was rejected by X.";
      throw new AppError("UPSTREAM_AUTH_ERROR", failure, response.status, false, {
        payload
      });
    }
    return (await response.json()) as OAuthTokenResponse;
  }

  private buildTokenRequest(request: {
    grantType: TokenRequestKind;
    code?: string;
    codeVerifier?: string;
    refreshToken?: string;
  }): { headers: Record<string, string>; body: URLSearchParams } {
    const body = new URLSearchParams();
    body.set("grant_type", request.grantType);

    if (request.grantType === "authorization_code") {
      if (!request.code || !request.codeVerifier) {
        throw new AppError("CONFIG_ERROR", "Authorization code exchange requires code and codeVerifier.", 500, false);
      }
      body.set("code", request.code);
      body.set("redirect_uri", this.env.xRedirectUri);
      body.set("code_verifier", request.codeVerifier);
    } else {
      if (!request.refreshToken) {
        throw new AppError("CONFIG_ERROR", "Refresh token exchange requires refreshToken.", 500, false);
      }
      body.set("refresh_token", request.refreshToken);
    }

    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded"
    };

    if (this.env.xClientSecret) {
      headers.authorization = buildBasicAuthHeader(this.env.xClientId, this.env.xClientSecret);
    } else {
      body.set("client_id", this.env.xClientId);
    }

    return { headers, body };
  }
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function randomSessionId(): string {
  return randomUUID();
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

function buildBasicAuthHeader(clientId: string, clientSecret: string): string {
  const token = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  return `Basic ${token}`;
}
