import { randomUUID } from "node:crypto";
import type { OAuthSessionStore, TokenSession } from "../auth/sessionTypes.js";
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
  tokenStore: OAuthSessionStore;
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

export function toolErrorResult(ctx: ToolContext, requestId: string, error: unknown) {
  const appError = asAppError(error);
  const authStartUrl = `${ctx.env.publicBaseUrl}/oauth/x/start`;
  const authChallengeCodes = new Set([
    "AUTH_REQUIRED",
    "AUTH_SCOPE_MISSING",
    "AUTH_TOKEN_INVALID",
    "AUTH_TOKEN_UNVERIFIABLE"
  ]);
  const authChallenge = authChallengeCodes.has(appError.code)
    ? {
        required: true,
        oauth_start_url: authStartUrl
      }
    : null;
  const errorDetails = {
    ...(appError.details ?? {}),
    ...(authChallenge ? { auth: authChallenge } : {})
  };
  const envelope: ErrorEnvelope = {
    ok: false,
    error: {
      code: appError.code,
      message: appError.message,
      retryable: appError.retryable,
      ...(Object.keys(errorDetails).length > 0 ? { details: errorDetails } : {})
    },
    meta: {
      request_id: requestId
    }
  };
  return {
    content: [{ type: "text" as const, text: `Request failed: ${appError.message}` }],
    structuredContent: envelope,
    isError: true,
    ...(authChallenge
      ? {
          _meta: {
            "mcp/www_authenticate": [`Bearer realm="x-timeline-mcp", authorization_uri="${authStartUrl}"`]
          }
        }
      : {})
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

export async function resolveOptionalAuthSession(
  ctx: ToolContext,
  sessionId: string | undefined,
  requiredScopes: string[]
): Promise<TokenSession | null> {
  if (!sessionId) {
    return null;
  }
  let session = await ctx.tokenStore.getSession(sessionId);
  if (!session) {
    throw new AppError("AUTH_REQUIRED", "OAuth session is missing or expired. Re-link your X account.", 401, false, {
      oauth_start_url: `${ctx.env.publicBaseUrl}/oauth/x/start`
    });
  }
  session = await ctx.oauthService.tryRefreshSession(session);
  await ctx.tokenVerifier.verify(session, { requiredScopes });
  const touched = await ctx.tokenStore.touchSession(session.sessionId);
  if (!touched) {
    throw new AppError("AUTH_REQUIRED", "OAuth session is missing, expired, or revoked. Re-link your X account.", 401, false, {
      oauth_start_url: `${ctx.env.publicBaseUrl}/oauth/x/start`
    });
  }
  return touched;
}

export async function requireOAuthSession(ctx: ToolContext, sessionId: string, requiredScopes: string[]): Promise<TokenSession> {
  const session = await resolveOptionalAuthSession(ctx, sessionId, requiredScopes);
  if (!session) {
    throw new AppError("AUTH_REQUIRED", "OAuth session is missing or expired. Re-link your X account.", 401, false, {
      oauth_start_url: `${ctx.env.publicBaseUrl}/oauth/x/start`
    });
  }
  return session;
}

export async function requireOAuthSessionWithLinkedAccount(
  ctx: ToolContext,
  sessionId: string,
  requiredScopes: string[]
): Promise<TokenSession> {
  const session = await requireOAuthSession(ctx, sessionId, requiredScopes);
  if (session.linkedAccount.id) {
    return session;
  }

  const response = await ctx.xClient.getAuthenticatedUser({
    mode: "oauth2",
    accessToken: session.accessToken
  });
  const user = normalizeSingleUser(response.data.data);
  if (!user) {
    throw new AppError(
      "UPSTREAM_ERROR",
      "X API did not return an authenticated user profile for the current OAuth session.",
      502,
      false,
      {
        endpoint: "/users/me"
      }
    );
  }

  const updated = await ctx.tokenStore.updateSession(session.sessionId, {
    linkedAccount: {
      id: user.id,
      username: user.username
    }
  });
  if (!updated) {
    throw new AppError("STORAGE_ERROR", "OAuth session could not be updated with linked account metadata.", 500, false);
  }
  return updated;
}

function normalizeSingleUser(value: unknown): { id: string; username: string } | null {
  if (typeof value !== "object" || !value) {
    return null;
  }
  const user = value as Record<string, unknown>;
  return typeof user.id === "string" && typeof user.username === "string"
    ? {
        id: user.id,
        username: user.username
      }
    : null;
}
