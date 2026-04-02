import { describe, expect, it } from "vitest";
import { normalizeTimelineBundle } from "../src/contracts/normalize.js";

describe("normalizeTimelineBundle failure handling", () => {
  it("throws when a required post string field is missing", () => {
    expect(() =>
      normalizeTimelineBundle({
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
            text: "post without an id"
          }
        ],
        includes: undefined,
        rateLimit: { limit: 100, remaining: 99, resetUnix: 1700000000 }
      })
    ).toThrowError(/missing required string field: id/i);
  });

  it("throws when a required media string field is missing", () => {
    expect(() =>
      normalizeTimelineBundle({
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
            text: "post with media include"
          }
        ],
        includes: {
          media: [
            {
              type: "photo"
            }
          ]
        },
        rateLimit: { limit: 100, remaining: 99, resetUnix: 1700000000 }
      })
    ).toThrowError(/missing required string field: media_key/i);
  });
});
