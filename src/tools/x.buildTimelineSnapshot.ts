import { normalizeTimelineBundle } from "../contracts/normalize.js";
import { buildSnapshotInputSchema } from "../contracts/toolSchemas.js";
import { AppError } from "../lib/errors.js";
import {
  makeRequestId,
  requireOAuthSessionWithLinkedAccount,
  requirePublicToken,
  resolveOptionalAuthSession,
  toolErrorResult,
  type ToolContext
} from "./shared.js";

export function registerBuildTimelineSnapshotTool(server: any, ctx: ToolContext) {
  server.registerTool(
    "x.build_timeline_snapshot",
    {
      title: "Build normalized X timeline snapshot bundle",
      description:
        "Use this when you need one normalized analysis bundle generated from a search, timeline, home-timeline, or post-batch retrieval flow.",
      inputSchema: buildSnapshotInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true
      },
      securitySchemes: [
        { type: "noauth" },
        { type: "oauth2", scopes: ["tweet.read", "users.read", "offline.access"] }
      ]
    },
    async (rawInput: unknown) => {
      const requestId = makeRequestId();
      try {
        const input = buildSnapshotInputSchema.parse(rawInput);

        if (input.mode === "home_timeline") {
          const session = await requireOAuthSessionWithLinkedAccount(ctx, requiredSessionId(input.oauth_session_id), [
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

          return {
            content: [{ type: "text" as const, text: "Built normalized home timeline snapshot." }],
            structuredContent: normalizeTimelineBundle({
              endpoint: `/users/${session.linkedAccount.id}/timelines/reverse_chronological`,
              authMode: "oauth2",
              query: null,
              cursor: input.pagination_token ?? null,
              accountId: session.linkedAccount.id,
              accountUsername: session.linkedAccount.username,
              timeWindow: null,
              limit: input.max_results,
              data: asData(response.data.data),
              includes: asIncludes(response.data.includes),
              partial: Array.isArray(response.data.errors) && response.data.errors.length > 0,
              limitations: [],
              nextCursor: getMetaToken(response.data.meta, "next_token"),
              previousCursor: getMetaToken(response.data.meta, "previous_token"),
              rateLimit: response.rateLimit
            })
          };
        }

        if (input.mode === "search_recent_posts") {
          if (!input.query) {
            throw new AppError("VALIDATION_ERROR", "query is required when mode=search_recent_posts.", 400, false);
          }
          const oauthSession = await resolveOptionalAuthSession(ctx, input.oauth_session_id, ["tweet.read"]);
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

          return {
            content: [{ type: "text" as const, text: "Built normalized recent-search snapshot." }],
            structuredContent: normalizeTimelineBundle({
              endpoint: "/tweets/search/recent",
              authMode,
              query: input.query,
              cursor: input.next_token ?? null,
              accountId: oauthSession?.linkedAccount.id ?? null,
              accountUsername: oauthSession?.linkedAccount.username ?? null,
              timeWindow: "P7D",
              limit: input.max_results,
              data: asData(response.data.data),
              includes: asIncludes(response.data.includes),
              partial: Array.isArray(response.data.errors) && response.data.errors.length > 0,
              limitations: ["Recent search only; full archive search is intentionally out of scope in V1."],
              nextCursor: getMetaToken(response.data.meta, "next_token"),
              previousCursor: getMetaToken(response.data.meta, "previous_token"),
              rateLimit: response.rateLimit
            })
          };
        }

        if (input.mode === "user_timeline") {
          if (!input.user_id) {
            throw new AppError("VALIDATION_ERROR", "user_id is required when mode=user_timeline.", 400, false);
          }
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

          return {
            content: [{ type: "text" as const, text: "Built normalized user timeline snapshot." }],
            structuredContent: normalizeTimelineBundle({
              endpoint: `/users/${input.user_id}/tweets`,
              authMode,
              query: null,
              cursor: input.pagination_token ?? null,
              accountId: input.user_id,
              accountUsername: null,
              timeWindow: null,
              limit: input.max_results,
              data: asData(response.data.data),
              includes: asIncludes(response.data.includes),
              partial: Array.isArray(response.data.errors) && response.data.errors.length > 0,
              limitations: [],
              nextCursor: getMetaToken(response.data.meta, "next_token"),
              previousCursor: getMetaToken(response.data.meta, "previous_token"),
              rateLimit: response.rateLimit
            })
          };
        }

        if (!input.post_ids?.length) {
          throw new AppError("VALIDATION_ERROR", "post_ids is required when mode=post_batch.", 400, false);
        }

        const oauthSession = await resolveOptionalAuthSession(ctx, input.oauth_session_id, ["tweet.read"]);
        const authMode = oauthSession ? "oauth2" : "noauth";
        const token = oauthSession?.accessToken ?? requirePublicToken(ctx.env);
        const response = await ctx.xClient.getPostBatch(input.post_ids, { mode: authMode, accessToken: token });

        return {
          content: [{ type: "text" as const, text: "Built normalized post-batch snapshot." }],
          structuredContent: normalizeTimelineBundle({
            endpoint: "/tweets",
            authMode,
            query: null,
            cursor: null,
            accountId: oauthSession?.linkedAccount.id ?? null,
            accountUsername: oauthSession?.linkedAccount.username ?? null,
            timeWindow: null,
            limit: input.post_ids.length,
            data: asData(response.data.data),
            includes: asIncludes(response.data.includes),
            partial: Array.isArray(response.data.errors) && response.data.errors.length > 0,
            limitations: response.data.errors ? ["Some requested post IDs were not returned by X API."] : [],
            rateLimit: response.rateLimit
          })
        };
      } catch (error) {
        ctx.logger.error({ requestId, tool: "x.build_timeline_snapshot", error }, "Tool failed");
        return toolErrorResult(ctx, requestId, error);
      }
    }
  );
}

function requiredSessionId(sessionId: string | undefined): string {
  if (!sessionId) {
    throw new AppError("AUTH_REQUIRED", "oauth_session_id is required for home timeline snapshots.", 401, false);
  }
  return sessionId;
}

function getMetaToken(meta: unknown, tokenName: "next_token" | "previous_token"): string | null {
  if (typeof meta !== "object" || !meta) {
    return null;
  }
  const value = (meta as Record<string, unknown>)[tokenName];
  return typeof value === "string" ? value : null;
}

function asData(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function asIncludes(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value ? (value as Record<string, unknown>) : undefined;
}
