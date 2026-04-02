import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toolNames } from "../src/tools/index.js";

const toolFiles = [
  "src/tools/x.lookupUsers.ts",
  "src/tools/x.searchRecentPosts.ts",
  "src/tools/x.getUserTimeline.ts",
  "src/tools/x.getPostBatch.ts",
  "src/tools/x.getAuthenticatedUser.ts",
  "src/tools/x.getHomeTimeline.ts",
  "src/tools/x.buildTimelineSnapshot.ts"
];

describe("tool catalog", () => {
  it("registers the expected V1 tool surface", () => {
    expect(toolNames).toEqual([
      "x.lookup_users",
      "x.search_recent_posts",
      "x.get_user_timeline",
      "x.get_post_batch",
      "x.get_authenticated_user",
      "x.get_home_timeline",
      "x.build_timeline_snapshot"
    ]);
  });

  it("uses 'Use this when...' descriptions for all tools", () => {
    for (const file of toolFiles) {
      const content = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(content).toMatch(/description:\s*"Use this when/i);
    }
  });
});
