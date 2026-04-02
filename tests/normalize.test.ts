import { describe, expect, it } from "vitest";
import { normalizeTimelineBundle } from "../src/contracts/normalize.js";

describe("normalizeTimelineBundle", () => {
  it("produces deterministic normalized fields", () => {
    const bundle = normalizeTimelineBundle({
      endpoint: "/tweets/search/recent",
      authMode: "noauth",
      query: "hello",
      cursor: null,
      accountId: null,
      accountUsername: null,
      timeWindow: "P7D",
      limit: 20,
      data: [
        {
          id: "1",
          text: "test post",
          author_id: "42",
          public_metrics: { like_count: 9 },
          entities: {
            hashtags: [{ tag: "AI" }],
            mentions: [{ username: "alice" }]
          }
        }
      ],
      includes: {
        users: [
          {
            id: "42",
            username: "bob",
            public_metrics: { followers_count: 10 }
          }
        ]
      },
      rateLimit: { limit: 100, remaining: 99, resetUnix: 1700000000 }
    });

    expect(bundle.posts).toHaveLength(1);
    const firstPost = bundle.posts[0];
    const firstUser = bundle.includes.users[0];
    expect(firstPost).toBeDefined();
    expect(firstUser).toBeDefined();
    expect(firstPost!.metrics.like_count).toBe(9);
    expect(firstPost!.entities.hashtags).toEqual(["AI"]);
    expect(firstUser!.metrics.followers_count).toBe(10);
    expect(bundle.meta.rate_limit.limit).toBe(100);
  });
});
