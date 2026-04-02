import { AppError } from "../lib/errors.js";
import { parseRateLimitHeaders, type RateLimitInfo } from "../lib/rateLimit.js";

export type XAuthMode = "noauth" | "oauth2";

export type XRequestResult<T> = {
  data: T;
  rateLimit: RateLimitInfo;
};

type Auth = {
  mode: XAuthMode;
  accessToken: string;
};

export class XApiClient {
  private readonly baseUrl = "https://api.x.com/2";

  async lookupUsersByUsernames(usernames: string[], auth: Auth) {
    return this.requestJson("/users/by", {
      auth,
      searchParams: {
        usernames: usernames.join(","),
        "user.fields":
          "created_at,description,profile_image_url,protected,public_metrics,verified,username,name"
      }
    });
  }

  async lookupUsersByIds(ids: string[], auth: Auth) {
    return this.requestJson("/users", {
      auth,
      searchParams: {
        ids: ids.join(","),
        "user.fields":
          "created_at,description,profile_image_url,protected,public_metrics,verified,username,name"
      }
    });
  }

  async searchRecentPosts(params: {
    auth: Auth;
    query: string;
    maxResults: number;
    nextToken?: string;
    startTime?: string;
    endTime?: string;
  }) {
    return this.requestJson("/tweets/search/recent", {
      auth: params.auth,
      searchParams: {
        query: params.query,
        max_results: String(params.maxResults),
        next_token: params.nextToken,
        start_time: params.startTime,
        end_time: params.endTime,
        expansions: "author_id,attachments.media_keys",
        "tweet.fields":
          "author_id,conversation_id,created_at,entities,in_reply_to_user_id,lang,public_metrics,referenced_tweets,text",
        "user.fields":
          "created_at,description,profile_image_url,protected,public_metrics,verified,username,name",
        "media.fields": "duration_ms,height,preview_image_url,type,url,width"
      }
    });
  }

  async getUserTimeline(params: {
    auth: Auth;
    userId: string;
    maxResults: number;
    paginationToken?: string;
    excludeReplies: boolean;
    excludeRetweets: boolean;
  }) {
    const exclude = [
      params.excludeReplies ? "replies" : null,
      params.excludeRetweets ? "retweets" : null
    ].filter((value): value is string => Boolean(value));

    return this.requestJson(`/users/${encodeURIComponent(params.userId)}/tweets`, {
      auth: params.auth,
      searchParams: {
        max_results: String(params.maxResults),
        pagination_token: params.paginationToken,
        exclude: exclude.length > 0 ? exclude.join(",") : undefined,
        expansions: "author_id,attachments.media_keys",
        "tweet.fields":
          "author_id,conversation_id,created_at,entities,in_reply_to_user_id,lang,public_metrics,referenced_tweets,text",
        "user.fields":
          "created_at,description,profile_image_url,protected,public_metrics,verified,username,name",
        "media.fields": "duration_ms,height,preview_image_url,type,url,width"
      }
    });
  }

  async getPostBatch(ids: string[], auth: Auth) {
    return this.requestJson("/tweets", {
      auth,
      searchParams: {
        ids: ids.join(","),
        expansions: "author_id,attachments.media_keys",
        "tweet.fields":
          "author_id,conversation_id,created_at,entities,in_reply_to_user_id,lang,public_metrics,referenced_tweets,text",
        "user.fields":
          "created_at,description,profile_image_url,protected,public_metrics,verified,username,name",
        "media.fields": "duration_ms,height,preview_image_url,type,url,width"
      }
    });
  }

  async getAuthenticatedUser(auth: Auth) {
    return this.requestJson("/users/me", {
      auth,
      searchParams: {
        "user.fields":
          "created_at,description,profile_image_url,protected,public_metrics,verified,username,name"
      }
    });
  }

  async getHomeTimeline(params: {
    auth: Auth;
    maxResults: number;
    paginationToken?: string;
    excludeReplies: boolean;
    excludeRetweets: boolean;
  }) {
    const exclude = [
      params.excludeReplies ? "replies" : null,
      params.excludeRetweets ? "retweets" : null
    ].filter((value): value is string => Boolean(value));

    return this.requestJson("/users/me/timelines/reverse_chronological", {
      auth: params.auth,
      searchParams: {
        max_results: String(params.maxResults),
        pagination_token: params.paginationToken,
        exclude: exclude.length > 0 ? exclude.join(",") : undefined,
        expansions: "author_id,attachments.media_keys",
        "tweet.fields":
          "author_id,conversation_id,created_at,entities,in_reply_to_user_id,lang,public_metrics,referenced_tweets,text",
        "user.fields":
          "created_at,description,profile_image_url,protected,public_metrics,verified,username,name",
        "media.fields": "duration_ms,height,preview_image_url,type,url,width"
      }
    });
  }

  private async requestJson(
    path: string,
    options: {
      auth: Auth;
      searchParams?: Record<string, string | undefined>;
    }
  ): Promise<XRequestResult<Record<string, unknown>>> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.searchParams ?? {})) {
      if (typeof value === "string" && value.length > 0) {
        url.searchParams.set(key, value);
      }
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          authorization: `Bearer ${options.auth.accessToken}`
        }
      });
    } catch (error) {
      throw new AppError("NETWORK_ERROR", "X API request failed due to a network error.", 502, true, {
        reason: error instanceof Error ? error.message : "unknown"
      });
    }

    const rateLimit = parseRateLimitHeaders(response.headers);

    if (response.status === 429) {
      throw new AppError("UPSTREAM_RATE_LIMITED", "X API rate limit exceeded.", 429, true, {
        rate_limit: {
          limit: rateLimit.limit,
          remaining: rateLimit.remaining,
          reset_unix: rateLimit.resetUnix
        }
      });
    }
    if (response.status === 401) {
      throw new AppError("UPSTREAM_AUTH_ERROR", "X API rejected the request due to authentication failure.", 401, false);
    }
    if (response.status === 403) {
      throw new AppError("UPSTREAM_FORBIDDEN", "X API rejected the request due to access or scope constraints.", 403, false);
    }
    if (response.status === 400) {
      const payload = await safeJson(response);
      throw new AppError("UPSTREAM_BAD_REQUEST", "X API rejected request parameters.", 400, false, {
        payload
      });
    }
    if (!response.ok) {
      const payload = await safeJson(response);
      throw new AppError("UPSTREAM_ERROR", "X API returned an unexpected error response.", response.status, true, {
        payload
      });
    }

    const data = (await response.json()) as Record<string, unknown>;
    return { data, rateLimit };
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
