import { lookupUsersInputSchema } from "../contracts/toolSchemas.js";
import { normalizeUsersResult } from "../contracts/normalize.js";
import { AppError } from "../lib/errors.js";
import type { RateLimitInfo } from "../lib/rateLimit.js";
import { makeRequestId, requirePublicToken, resolveOptionalAuthSession, toolErrorResult, type ToolContext } from "./shared.js";

export function registerLookupUsersTool(server: any, ctx: ToolContext) {
  server.registerTool(
    "x.lookup_users",
    {
      title: "Lookup X users by username or ID",
      description:
        "Use this when you need canonical user profiles for one or more X usernames and/or user IDs before timeline or search analysis.",
      inputSchema: lookupUsersInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true
      },
      securitySchemes: [
        { type: "noauth" },
        { type: "oauth2", scopes: ["tweet.read", "users.read"] }
      ]
    },
    async (rawInput: unknown) => {
      const requestId = makeRequestId();
      try {
        const input = lookupUsersInputSchema.parse(rawInput);
        if (!input.usernames?.length && !input.ids?.length) {
          throw new AppError("VALIDATION_ERROR", "Provide at least one username or one ID.", 400, false);
        }

        const oauthSession = await resolveOptionalAuthSession(ctx, input.oauth_session_id, ["users.read"]);
        const authMode = oauthSession ? "oauth2" : "noauth";
        const token = oauthSession?.accessToken ?? requirePublicToken(ctx.env);

        const users: unknown[] = [];
        let rateLimit: RateLimitInfo = { limit: null, remaining: null, resetUnix: null };

        if (input.usernames?.length) {
          const byUsername = await ctx.xClient.lookupUsersByUsernames(input.usernames, { mode: authMode, accessToken: token });
          const found = Array.isArray(byUsername.data.data) ? byUsername.data.data : [];
          users.push(...found);
          rateLimit = byUsername.rateLimit;
        }
        if (input.ids?.length) {
          const byIds = await ctx.xClient.lookupUsersByIds(input.ids, { mode: authMode, accessToken: token });
          const found = Array.isArray(byIds.data.data) ? byIds.data.data : [];
          users.push(...found);
          rateLimit = byIds.rateLimit;
        }

        const deduped = dedupeById(users);
        const normalized = normalizeUsersResult({
          endpoint: "/users,/users/by",
          authMode,
          users: deduped,
          rateLimit
        });

        return {
          content: [{ type: "text" as const, text: `Resolved ${normalized.users.length} user record(s).` }],
          structuredContent: normalized
        };
      } catch (error) {
        ctx.logger.error({ requestId, tool: "x.lookup_users", error }, "Tool failed");
        return toolErrorResult(ctx, requestId, error);
      }
    }
  );
}

function dedupeById(users: unknown[]): unknown[] {
  const map = new Map<string, unknown>();
  for (const user of users) {
    if (typeof user === "object" && user !== null && typeof (user as { id?: unknown }).id === "string") {
      map.set((user as { id: string }).id, user);
    }
  }
  return [...map.values()];
}
