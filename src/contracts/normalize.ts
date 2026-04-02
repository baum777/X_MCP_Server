import type { RateLimitInfo } from "../lib/rateLimit.js";
import type { NormalizedTimelineBundle, NormalizedUserLookupResult } from "./xSchemas.js";
import { normalizedTimelineBundleSchema, normalizedUserLookupResultSchema, xUserSchema } from "./xSchemas.js";

type AuthMode = "noauth" | "oauth2";

type RawPost = Record<string, unknown>;
type RawIncludes = Record<string, unknown> | undefined;

export function normalizeUsersResult(params: {
  endpoint: string;
  authMode: AuthMode;
  users: unknown[];
  rateLimit: RateLimitInfo;
  limitations?: string[];
}): NormalizedUserLookupResult {
  const result: NormalizedUserLookupResult = {
    source: {
      platform: "x",
      endpoint: params.endpoint,
      fetched_at: new Date().toISOString(),
      auth_mode: params.authMode,
      query: null,
      cursor: null
    },
    users: params.users.map(normalizeUser),
    meta: {
      partial: false,
      limitations: params.limitations ?? [],
      rate_limit: {
        limit: params.rateLimit.limit,
        remaining: params.rateLimit.remaining,
        reset_unix: params.rateLimit.resetUnix
      }
    }
  };
  return normalizedUserLookupResultSchema.parse(result);
}

export function normalizeTimelineBundle(params: {
  endpoint: string;
  authMode: AuthMode;
  query: string | null;
  cursor: string | null;
  accountId: string | null;
  accountUsername: string | null;
  timeWindow: string | null;
  limit: number;
  data: RawPost[] | undefined;
  includes: RawIncludes;
  limitations?: string[];
  partial?: boolean;
  nextCursor?: string | null;
  previousCursor?: string | null;
  rateLimit: RateLimitInfo;
}): NormalizedTimelineBundle {
  const rawUsers = Array.isArray(params.includes?.users) ? (params.includes.users as unknown[]) : [];
  const rawMedia = Array.isArray(params.includes?.media) ? (params.includes.media as Record<string, unknown>[]) : [];

  const result: NormalizedTimelineBundle = {
    source: {
      platform: "x",
      endpoint: params.endpoint,
      fetched_at: new Date().toISOString(),
      auth_mode: params.authMode,
      query: params.query,
      cursor: params.cursor
    },
    scope: {
      account_id: params.accountId,
      account_username: params.accountUsername,
      time_window: params.timeWindow,
      limit: params.limit
    },
    posts: (params.data ?? []).map(normalizePost),
    includes: {
      users: rawUsers.map(normalizeUser),
      media: rawMedia.map(normalizeMedia)
    },
    meta: {
      partial: params.partial ?? false,
      limitations: params.limitations ?? [],
      rate_limit: {
        limit: params.rateLimit.limit,
        remaining: params.rateLimit.remaining,
        reset_unix: params.rateLimit.resetUnix
      }
    },
    pagination: {
      next_cursor: params.nextCursor ?? null,
      previous_cursor: params.previousCursor ?? null
    }
  };
  return normalizedTimelineBundleSchema.parse(result);
}

export function normalizeUser(raw: unknown) {
  const parsed = xUserSchema.parse(raw);
  return {
    id: parsed.id,
    username: parsed.username,
    name: parsed.name ?? null,
    created_at: parsed.created_at ?? null,
    description: parsed.description ?? null,
    profile_image_url: parsed.profile_image_url ?? null,
    protected: parsed.protected ?? null,
    verified: parsed.verified ?? null,
    metrics: {
      followers_count: parsed.public_metrics?.followers_count ?? null,
      following_count: parsed.public_metrics?.following_count ?? null,
      post_count: parsed.public_metrics?.tweet_count ?? null,
      listed_count: parsed.public_metrics?.listed_count ?? null
    }
  };
}

function normalizePost(raw: RawPost) {
  const entities = (raw.entities as Record<string, unknown> | undefined) ?? {};
  const publicMetrics = (raw.public_metrics as Record<string, unknown> | undefined) ?? {};
  const referenced = Array.isArray(raw.referenced_tweets) ? raw.referenced_tweets : [];
  return {
    id: asString(raw.id),
    text: asString(raw.text),
    author_id: asNullableString(raw.author_id),
    created_at: asNullableString(raw.created_at),
    language: asNullableString(raw.lang),
    conversation_id: asNullableString(raw.conversation_id),
    in_reply_to_user_id: asNullableString(raw.in_reply_to_user_id),
    referenced: referenced
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({
        id: asString(item.id),
        type: asString(item.type)
      })),
    metrics: {
      retweet_count: asNullableNumber(publicMetrics.retweet_count),
      reply_count: asNullableNumber(publicMetrics.reply_count),
      like_count: asNullableNumber(publicMetrics.like_count),
      quote_count: asNullableNumber(publicMetrics.quote_count),
      bookmark_count: asNullableNumber(publicMetrics.bookmark_count),
      impression_count: asNullableNumber(publicMetrics.impression_count)
    },
    entities: {
      hashtags: extractTagArray(entities.hashtags, "tag"),
      cashtags: extractTagArray(entities.cashtags, "tag"),
      mentions: extractTagArray(entities.mentions, "username"),
      urls: extractUrlArray(entities.urls)
    }
  };
}

function normalizeMedia(raw: Record<string, unknown>) {
  return {
    media_key: asString(raw.media_key),
    type: asString(raw.type),
    url: asNullableString(raw.url),
    preview_image_url: asNullableString(raw.preview_image_url),
    duration_ms: asNullableNumber(raw.duration_ms),
    width: asNullableNumber(raw.width),
    height: asNullableNumber(raw.height)
  };
}

function extractTagArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => item[key])
    .filter((item): item is string => typeof item === "string");
}

function extractUrlArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => (typeof item.expanded_url === "string" ? item.expanded_url : item.url))
    .filter((item): item is string => typeof item === "string");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
