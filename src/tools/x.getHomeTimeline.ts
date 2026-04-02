import { normalizeTimelineBundle } from "../contracts/normalize.js";
import { getHomeTimelineInputSchema } from "../contracts/toolSchemas.js";
import {
  makeRequestId,
  requireOAuthSessionWithLinkedAccount,
  toolErrorResult,
  type ToolContext
} from "./shared.js";

export function registerGetHomeTimelineTool(server: any, ctx: ToolContext) {
  server.registerTool(
    "x.get_home_timeline",
    {
      title: "Get linked account home timeline",
      description:
        "Use this when you need the reverse-chronological home timeline for the OAuth-linked X account.",
      inputSchema: getHomeTimelineInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true
      },
      securitySchemes: [{ type: "oauth2", scopes: ["tweet.read", "users.read", "offline.access"] }]
    },
    async (rawInput: unknown) => {
      const requestId = makeRequestId();
      try {
        const input = getHomeTimelineInputSchema.parse(rawInput);
        const session = await requireOAuthSessionWithLinkedAccount(ctx, input.oauth_session_id, [
          "tweet.read",
          "users.read"
        ]);
        const homeParams: {
          auth: { mode: "oauth2"; accessToken: string };
          userId: string;
          maxResults: number;
          paginationToken?: string;
          excludeReplies: boolean;
          excludeRetweets: boolean;
        } = {
          auth: { mode: "oauth2", accessToken: session.accessToken },
          userId: session.linkedAccount.id as string,
          maxResults: input.max_results,
          excludeReplies: input.exclude_replies,
          excludeRetweets: input.exclude_retweets
        };
        if (input.pagination_token) {
          homeParams.paginationToken = input.pagination_token;
        }
        const response = await ctx.xClient.getHomeTimelineByUserId(homeParams);

        const normalized = normalizeTimelineBundle({
          endpoint: `/users/${session.linkedAccount.id}/timelines/reverse_chronological`,
          authMode: "oauth2",
          query: null,
          cursor: input.pagination_token ?? null,
          accountId: session.linkedAccount.id,
          accountUsername: session.linkedAccount.username,
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
          content: [{ type: "text" as const, text: `Returned ${normalized.posts.length} home timeline post(s).` }],
          structuredContent: normalized
        };
      } catch (error) {
        ctx.logger.error({ requestId, tool: "x.get_home_timeline", error }, "Tool failed");
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
