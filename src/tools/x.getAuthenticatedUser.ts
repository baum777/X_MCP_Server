import { normalizeUsersResult } from "../contracts/normalize.js";
import { oauthSessionInputSchema } from "../contracts/toolSchemas.js";
import { requireOAuthSession, makeRequestId, toolErrorResult, type ToolContext } from "./shared.js";

export function registerGetAuthenticatedUserTool(server: any, ctx: ToolContext) {
  server.registerTool(
    "x.get_authenticated_user",
    {
      title: "Get linked X account identity",
      description:
        "Use this when you need to verify which X account is linked to the current OAuth session before user-scoped timeline analysis.",
      inputSchema: oauthSessionInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true
      },
      securitySchemes: [{ type: "oauth2", scopes: ["tweet.read", "users.read", "offline.access"] }]
    },
    async (rawInput: unknown) => {
      const requestId = makeRequestId();
      try {
        const input = oauthSessionInputSchema.parse(rawInput);
        const session = await requireOAuthSession(ctx, input.oauth_session_id, ["tweet.read", "users.read", "offline.access"]);

        const response = await ctx.xClient.getAuthenticatedUser({
          mode: "oauth2",
          accessToken: session.accessToken
        });

        const user = response.data.data;
        const users = user ? [user] : [];
        const normalized = normalizeUsersResult({
          endpoint: "/users/me",
          authMode: "oauth2",
          users,
          rateLimit: response.rateLimit
        });

        if (normalized.users[0]) {
          ctx.tokenStore.createOrUpdateSession({
            sessionId: session.sessionId,
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            scope: session.scope,
            expiresAtUnix: session.expiresAtUnix,
            linkedAccount: {
              id: normalized.users[0].id,
              username: normalized.users[0].username
            }
          });
        }

        return {
          content: [{ type: "text" as const, text: "Authenticated user profile returned." }],
          structuredContent: normalized
        };
      } catch (error) {
        ctx.logger.error({ requestId, tool: "x.get_authenticated_user", error }, "Tool failed");
        return toolErrorResult(requestId, error);
      }
    }
  );
}
