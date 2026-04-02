import { randomUUID } from "node:crypto";
import type { InMemoryTokenStore, TokenSession } from "../auth/tokenStore.js";
import type { OAuthTokenVerifier } from "../auth/tokenVerifier.js";
import type { XOAuthService } from "../auth/oauth.js";
import type { XApiClient } from "../clients/xApiClient.js";
import type { Env } from "../config/env.js";
import { AppError, asAppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

export type ToolContext = {
  env: Env;
  logger: Logger;
  xClient: XApiClient;
  tokenStore: InMemoryTokenStore;
  tokenVerifier: OAuthTokenVerifier;
  oauthService: XOAuthService;
};

type ErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
  meta: {
    request_id: string;
  };
};

export function makeRequestId() {
  return randomUUID();
}

export function toolErrorResult(requestId: string, error: unknown) {
  const appError = asAppError(error);
  const errorDetails = appError.details ? { details: appError.details } : {};
  const envelope: ErrorEnvelope = {
    ok: false,
    error: {
      code: appError.code,
      message: appError.message,
      retryable: appError.retryable,
      ...errorDetails
    },
    meta: {
      request_id: requestId
    }
  };
  return {
    content: [{ type: "text" as const, text: `Request failed: ${appError.message}` }],
    structuredContent: envelope,
    isError: true
  };
}

export function requirePublicToken(env: Env): string {
  if (!env.xAppBearerToken) {
    throw new AppError(
      "AUTH_REQUIRED",
      "Public app bearer token is not configured. Set X_APP_BEARER_TOKEN or provide oauth_session_id.",
      401,
      false
    );
  }
  return env.xAppBearerToken;
}

export async function resolveOptionalAuthSession(ctx: ToolContext, sessionId?: string): Promise<TokenSession | null> {
  if (!sessionId) {
    return null;
  }
  let session = ctx.tokenStore.getSession(sessionId);
  if (!session) {
    throw new AppError("AUTH_REQUIRED", "OAuth session is missing or expired. Re-link your X account.", 401, false, {
      oauth_start_url: `${ctx.env.publicBaseUrl}/oauth/x/start`
    });
  }
  session = await ctx.oauthService.tryRefreshSession(session);
  await ctx.tokenVerifier.verify(session, { requiredScopes: ["tweet.read", "users.read"] });
  return session;
}

export async function requireOAuthSession(ctx: ToolContext, sessionId: string, requiredScopes: string[]): Promise<TokenSession> {
  let session = ctx.tokenStore.getSession(sessionId);
  if (!session) {
    throw new AppError("AUTH_REQUIRED", "OAuth session is missing or expired. Re-link your X account.", 401, false, {
      oauth_start_url: `${ctx.env.publicBaseUrl}/oauth/x/start`
    });
  }
  session = await ctx.oauthService.tryRefreshSession(session);
  await ctx.tokenVerifier.verify(session, { requiredScopes });
  return session;
}
