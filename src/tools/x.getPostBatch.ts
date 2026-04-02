import { normalizeTimelineBundle } from "../contracts/normalize.js";
import { getPostBatchInputSchema } from "../contracts/toolSchemas.js";
import { makeRequestId, requirePublicToken, resolveOptionalAuthSession, toolErrorResult, type ToolContext } from "./shared.js";

export function registerGetPostBatchTool(server: any, ctx: ToolContext) {
  server.registerTool(
    "x.get_post_batch",
    {
      title: "Get an X post batch by IDs",
      description:
        "Use this when you need to hydrate a known batch of X post IDs after a search or timeline retrieval step.",
      inputSchema: getPostBatchInputSchema.shape,
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
        const input = getPostBatchInputSchema.parse(rawInput);
        const oauthSession = await resolveOptionalAuthSession(ctx, input.oauth_session_id);
        const authMode = oauthSession ? "oauth2" : "noauth";
        const token = oauthSession?.accessToken ?? requirePublicToken(ctx.env);

        const response = await ctx.xClient.getPostBatch(input.post_ids, { mode: authMode, accessToken: token });
        const normalized = normalizeTimelineBundle({
          endpoint: "/tweets",
          authMode,
          query: null,
          cursor: null,
          accountId: oauthSession?.linkedAccount.id ?? null,
          accountUsername: oauthSession?.linkedAccount.username ?? null,
          timeWindow: null,
          limit: input.post_ids.length,
          data: Array.isArray(response.data.data) ? (response.data.data as Record<string, unknown>[]) : [],
          includes: (response.data.includes as Record<string, unknown> | undefined) ?? undefined,
          partial: Array.isArray(response.data.errors) && response.data.errors.length > 0,
          limitations: response.data.errors ? ["Some requested post IDs were not returned by X API."] : [],
          rateLimit: response.rateLimit
        });

        return {
          content: [{ type: "text" as const, text: `Hydrated ${normalized.posts.length} post(s).` }],
          structuredContent: normalized
        };
      } catch (error) {
        ctx.logger.error({ requestId, tool: "x.get_post_batch", error }, "Tool failed");
        return toolErrorResult(requestId, error);
      }
    }
  );
}
