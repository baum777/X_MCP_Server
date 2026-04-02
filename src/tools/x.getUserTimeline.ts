import { normalizeTimelineBundle } from "../contracts/normalize.js";
import { getUserTimelineInputSchema } from "../contracts/toolSchemas.js";
import { makeRequestId, requirePublicToken, resolveOptionalAuthSession, toolErrorResult, type ToolContext } from "./shared.js";

export function registerGetUserTimelineTool(server: any, ctx: ToolContext) {
  server.registerTool(
    "x.get_user_timeline",
    {
      title: "Get a user's recent X timeline",
      description:
        "Use this when you need recent posts for a specific X user ID with optional reply/retweet exclusion and pagination.",
      inputSchema: getUserTimelineInputSchema.shape,
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
        const input = getUserTimelineInputSchema.parse(rawInput);
        const oauthSession = await resolveOptionalAuthSession(ctx, input.oauth_session_id, ["tweet.read"]);
        const authMode = oauthSession ? "oauth2" : "noauth";
        const token = oauthSession?.accessToken ?? requirePublicToken(ctx.env);

        const timelineParams: {
          auth: { mode: "noauth" | "oauth2"; accessToken: string };
          userId: string;
          maxResults: number;
          paginationToken?: string;
          excludeReplies: boolean;
          excludeRetweets: boolean;
        } = {
          auth: { mode: authMode, accessToken: token },
          userId: input.user_id,
          maxResults: input.max_results,
          excludeReplies: input.exclude_replies,
          excludeRetweets: input.exclude_retweets
        };
        if (input.pagination_token) {
          timelineParams.paginationToken = input.pagination_token;
        }

        const response = await ctx.xClient.getUserTimeline(timelineParams);

        const normalized = normalizeTimelineBundle({
          endpoint: `/users/${input.user_id}/tweets`,
          authMode,
          query: null,
          cursor: input.pagination_token ?? null,
          accountId: input.user_id,
          accountUsername: null,
          timeWindow: null,
          limit: input.max_results,
          data: Array.isArray(response.data.data) ? (response.data.data as Record<string, unknown>[]) : [],
          includes: (response.data.includes as Record<string, unknown> | undefined) ?? undefined,
          partial: Array.isArray(response.data.errors) && response.data.errors.length > 0,
          nextCursor: getMetaToken(response.data.meta, "next_token"),
          previousCursor: getMetaToken(response.data.meta, "previous_token"),
          rateLimit: response.rateLimit
        });

        return {
          content: [{ type: "text" as const, text: `Returned ${normalized.posts.length} timeline post(s).` }],
          structuredContent: normalized
        };
      } catch (error) {
        ctx.logger.error({ requestId, tool: "x.get_user_timeline", error }, "Tool failed");
        return toolErrorResult(ctx, requestId, error);
      }
    }
  );
}

function getMetaToken(meta: unknown, tokenName: "next_token" | "previous_token"): string | null {
  if (typeof meta !== "object" || !meta) {
    return null;
  }
  const value = (meta as Record<string, unknown>)[tokenName];
  return typeof value === "string" ? value : null;
}
