import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { XApiClient } from "../src/clients/xApiClient.js";
import { requireOAuthSessionWithLinkedAccount } from "../src/tools/shared.js";

describe("home timeline flow", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the ID-based home timeline endpoint", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [], includes: {}, meta: {} }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-rate-limit-limit": "100",
          "x-rate-limit-remaining": "99",
          "x-rate-limit-reset": "1700000000"
        }
      })
    );

    const client = new XApiClient();
    await client.getHomeTimelineByUserId({
      auth: { mode: "oauth2", accessToken: "token" },
      userId: "12345",
      maxResults: 20,
      excludeReplies: false,
      excludeRetweets: false
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [url] = firstCall!;
    expect(String(url)).toContain("/2/users/12345/timelines/reverse_chronological");
    expect(String(url)).not.toContain("/2/users/me/timelines/reverse_chronological");
  });

  it("hydrates a missing linked account before the home timeline runs", async () => {
    const session = {
      sessionId: "session-1",
      accessToken: "token",
      refreshToken: null,
      scope: ["tweet.read", "users.read", "offline.access"],
      expiresAtUnix: Math.floor(Date.now() / 1000) + 3600,
      linkedAccount: { id: null, username: null },
      createdAtUnix: 1,
      updatedAtUnix: 1,
      lastUsedAtUnix: 1,
      status: "active"
    };

    const tokenStore = {
      getSession: vi.fn(async () => session),
      touchSession: vi.fn(async () => ({ ...session, lastUsedAtUnix: Math.floor(Date.now() / 1000) })),
      updateSession: vi.fn(async (_sessionId, next) => ({
        ...session,
        ...next,
        linkedAccount: next.linkedAccount ?? session.linkedAccount
      }))
    };
    const xClient = {
      getAuthenticatedUser: vi.fn(async () => ({
        data: {
          data: {
            id: "9988",
            username: "linked-user"
          }
        },
        rateLimit: { limit: null, remaining: null, resetUnix: null }
      }))
    };
    const oauthService = {
      tryRefreshSession: vi.fn(async (value) => value)
    };
    const tokenVerifier = {
      verify: vi.fn(async () => undefined)
    };
    const ctx = {
      env: { publicBaseUrl: "https://example.com" },
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() },
      xClient,
      tokenStore,
      tokenVerifier,
      oauthService
    } as never;

    const result = await requireOAuthSessionWithLinkedAccount(ctx, "session-1", ["tweet.read"]);

    expect(xClient.getAuthenticatedUser).toHaveBeenCalledTimes(1);
    expect(tokenStore.updateSession).toHaveBeenCalledWith("session-1", {
      linkedAccount: {
        id: "9988",
        username: "linked-user"
      }
    });
    expect(result.linkedAccount.id).toBe("9988");
  });
});
