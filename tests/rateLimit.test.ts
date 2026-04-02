import { describe, expect, it } from "vitest";
import { parseRateLimitHeaders } from "../src/lib/rateLimit.js";

describe("parseRateLimitHeaders", () => {
  it("maps x-rate-limit headers into numbers", () => {
    const headers = new Headers({
      "x-rate-limit-limit": "300",
      "x-rate-limit-remaining": "299",
      "x-rate-limit-reset": "1700000000"
    });
    const result = parseRateLimitHeaders(headers);
    expect(result).toEqual({
      limit: 300,
      remaining: 299,
      resetUnix: 1700000000
    });
  });

  it("returns null values when headers are absent", () => {
    const result = parseRateLimitHeaders(new Headers());
    expect(result).toEqual({
      limit: null,
      remaining: null,
      resetUnix: null
    });
  });
});
