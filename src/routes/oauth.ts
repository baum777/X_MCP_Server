import type { Express } from "express";
import type { XOAuthService } from "../auth/oauth.js";
import type { InMemoryTokenStore } from "../auth/tokenStore.js";
import type { XApiClient } from "../clients/xApiClient.js";
import { asAppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

export function registerOAuthRoutes(app: Express, services: {
  oauthService: XOAuthService;
  xClient: XApiClient;
  tokenStore: InMemoryTokenStore;
  logger: Logger;
}) {
  app.get("/oauth/x/start", (_req, res) => {
    const flow = services.oauthService.buildAuthorizeRedirectUrl();
    res.redirect(flow.url);
  });

  app.get("/oauth/x/callback", async (req, res) => {
    try {
      const code = asString(req.query.code);
      const state = asString(req.query.state);
      if (!code || !state) {
        res.status(400).json({
          ok: false,
          error: "Missing required query params: code and state."
        });
        return;
      }

      const session = await services.oauthService.exchangeCodeForSession({ code, state });
      let accountId: string | null = null;
      let accountUsername: string | null = null;
      try {
        const me = await services.xClient.getAuthenticatedUser({ mode: "oauth2", accessToken: session.accessToken });
        const user = typeof me.data.data === "object" && me.data.data ? (me.data.data as Record<string, unknown>) : null;
        accountId = typeof user?.id === "string" ? user.id : null;
        accountUsername = typeof user?.username === "string" ? user.username : null;
        services.tokenStore.createOrUpdateSession({
          sessionId: session.sessionId,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          scope: session.scope,
          expiresAtUnix: session.expiresAtUnix,
          linkedAccount: {
            id: accountId,
            username: accountUsername
          }
        });
      } catch (error) {
        services.logger.warn({ error }, "OAuth callback completed but users/me fetch failed.");
      }

      res.status(200).json({
        ok: true,
        oauth_session_id: session.sessionId,
        linked_account: {
          id: accountId,
          username: accountUsername
        },
        note: "Provide oauth_session_id in OAuth-required MCP tool inputs."
      });
    } catch (error) {
      const appError = asAppError(error);
      res.status(appError.status).json({
        ok: false,
        code: appError.code,
        message: appError.message,
        details: appError.details ?? null
      });
    }
  });
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
