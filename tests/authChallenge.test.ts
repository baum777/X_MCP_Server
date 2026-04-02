import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { toolErrorResult } from "../src/tools/shared.js";

describe("toolErrorResult auth challenge", () => {
  it("adds auth challenge metadata for auth-required failures", () => {
    const env = { publicBaseUrl: "https://example.com" } as never;
    const result = toolErrorResult(
      {
        env,
        logger: {} as never,
        xClient: {} as never,
        tokenStore: {} as never,
        tokenVerifier: {} as never,
        oauthService: {} as never
      },
      "req_123",
      new AppError("AUTH_REQUIRED", "OAuth session missing.", 401, false)
    );

    const envelope = result as typeof result & {
      _meta?: {
        "mcp/www_authenticate"?: string[];
      };
    };

    expect(envelope.isError).toBe(true);
    expect(envelope.structuredContent.error.code).toBe("AUTH_REQUIRED");
    expect(envelope.structuredContent.error.details).toMatchObject({
      auth: {
        required: true,
        oauth_start_url: "https://example.com/oauth/x/start"
      }
    });
    expect(envelope._meta?.["mcp/www_authenticate"]).toEqual([
      'Bearer realm="x-timeline-mcp", authorization_uri="https://example.com/oauth/x/start"'
    ]);
  });
});
