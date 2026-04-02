import { normalizeTimelineBundle } from "../contracts/normalize.js";
import { searchRecentPostsInputSchema } from "../contracts/toolSchemas.js";
import { AppError } from "../lib/errors.js";
import { makeRequestId, requirePublicToken, resolveOptionalAuthSession, toolErrorResult, type ToolContext } from "./shared.js";

export function registerSearchRecentPostsTool(server: any, ctx: ToolContext) {
  server.registerTool(
    "x.search_recent_posts",
    {
      title: "Search recent X posts",
      description:
        "Use this when you need last-7-days X search results for keywords, handles, hashtags, cashtags, or narrative phrases.",
      inputSchema: searchRecentPostsInputSchema.shape,
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
        const input = searchRecentPostsInputSchema.parse(rawInput);
        ensureRecentWindow(input.start_time, input.end_time);

        const oauthSession = await resolveOptionalAuthSession(ctx, input.oauth_session_id);
        const authMode = oauthSession ? "oauth2" : "noauth";
        const token = oauthSession?.accessToken ?? requirePublicToken(ctx.env);

        const searchParams: {
          auth: { mode: "noauth" | "oauth2"; accessToken: string };
          query: string;
          maxResults: number;
          nextToken?: string;
          startTime?: string;
          endTime?: string;
        } = {
          auth: { mode: authMode, accessToken: token },
          query: input.query,
          maxResults: input.max_results
        };
        if (input.next_token) searchParams.nextToken = input.next_token;
        if (input.start_time) searchParams.startTime = input.start_time;
        if (input.end_time) searchParams.endTime = input.end_time;

        const response = await ctx.xClient.searchRecentPosts(searchParams);

        const limitations = ["Recent search only; full archive search is intentionally out of scope in V1."];
        const normalized = normalizeTimelineBundle({
          endpoint: "/tweets/search/recent",
          authMode,
          query: input.query,
          cursor: input.next_token ?? null,
          accountId: oauthSession?.linkedAccount.id ?? null,
          accountUsername: oauthSession?.linkedAccount.username ?? null,
          timeWindow: "P7D",
          limit: input.max_results,
          data: Array.isArray(response.data.data) ? (response.data.data as Record<string, unknown>[]) : [],
          includes: (response.data.includes as Record<string, unknown> | undefined) ?? undefined,
          limitations,
          partial: Array.isArray(response.data.errors) && response.data.errors.length > 0,
          nextCursor: getMetaToken(response.data.meta, "next_token"),
          previousCursor: getMetaToken(response.data.meta, "previous_token"),
          rateLimit: response.rateLimit
        });

        return {
          content: [{ type: "text" as const, text: `Returned ${normalized.posts.length} recent post(s).` }],
          structuredContent: normalized
        };
      } catch (error) {
        ctx.logger.error({ requestId, tool: "x.search_recent_posts", error }, "Tool failed");
        return toolErrorResult(requestId, error);
      }
    }
  );
}

function ensureRecentWindow(startTime?: string, endTime?: string) {
  if (!startTime && !endTime) {
    return;
  }
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const start = startTime ? Date.parse(startTime) : now;
  const end = endTime ? Date.parse(endTime) : now;
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new AppError("VALIDATION_ERROR", "start_time/end_time must be ISO-8601 datetimes.", 400, false);
  }
  if (start < sevenDaysAgo || end < sevenDaysAgo) {
    throw new AppError("VALIDATION_ERROR", "x.search_recent_posts is limited to the last 7 days in V1.", 400, false);
  }
}

function getMetaToken(meta: unknown, tokenName: "next_token" | "previous_token"): string | null {
  if (typeof meta !== "object" || !meta) {
    return null;
  }
  const value = (meta as Record<string, unknown>)[tokenName];
  return typeof value === "string" ? value : null;
}
