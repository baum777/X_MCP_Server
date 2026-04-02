import { registerBuildTimelineSnapshotTool } from "./x.buildTimelineSnapshot.js";
import { registerGetAuthenticatedUserTool } from "./x.getAuthenticatedUser.js";
import { registerGetHomeTimelineTool } from "./x.getHomeTimeline.js";
import { registerGetPostBatchTool } from "./x.getPostBatch.js";
import { registerGetUserTimelineTool } from "./x.getUserTimeline.js";
import { registerLookupUsersTool } from "./x.lookupUsers.js";
import { registerSearchRecentPostsTool } from "./x.searchRecentPosts.js";
import type { ToolContext } from "./shared.js";

export const toolNames = [
  "x.lookup_users",
  "x.search_recent_posts",
  "x.get_user_timeline",
  "x.get_post_batch",
  "x.get_authenticated_user",
  "x.get_home_timeline",
  "x.build_timeline_snapshot"
] as const;

export function registerAllTools(server: any, ctx: ToolContext) {
  registerLookupUsersTool(server, ctx);
  registerSearchRecentPostsTool(server, ctx);
  registerGetUserTimelineTool(server, ctx);
  registerGetPostBatchTool(server, ctx);
  registerGetAuthenticatedUserTool(server, ctx);
  registerGetHomeTimelineTool(server, ctx);
  registerBuildTimelineSnapshotTool(server, ctx);
}
