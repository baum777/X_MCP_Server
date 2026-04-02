import { z } from "zod";

export const xUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  profile_image_url: z.string().nullable().optional(),
  protected: z.boolean().optional(),
  verified: z.boolean().optional(),
  public_metrics: z
    .object({
      followers_count: z.number().optional(),
      following_count: z.number().optional(),
      tweet_count: z.number().optional(),
      listed_count: z.number().optional()
    })
    .partial()
    .optional()
});

export const xMediaSchema = z.object({
  media_key: z.string(),
  type: z.string(),
  url: z.string().optional(),
  preview_image_url: z.string().optional(),
  duration_ms: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional()
});

export const xPostSchema = z.object({
  id: z.string(),
  text: z.string(),
  author_id: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  lang: z.string().nullable().optional(),
  conversation_id: z.string().nullable().optional(),
  in_reply_to_user_id: z.string().nullable().optional(),
  public_metrics: z
    .object({
      retweet_count: z.number().optional(),
      reply_count: z.number().optional(),
      like_count: z.number().optional(),
      quote_count: z.number().optional(),
      bookmark_count: z.number().optional(),
      impression_count: z.number().optional()
    })
    .partial()
    .optional(),
  entities: z
    .object({
      hashtags: z.array(z.object({ tag: z.string() })).optional(),
      cashtags: z.array(z.object({ tag: z.string() })).optional(),
      mentions: z.array(z.object({ username: z.string() })).optional(),
      urls: z.array(z.object({ expanded_url: z.string().optional(), url: z.string().optional() })).optional()
    })
    .partial()
    .optional(),
  referenced_tweets: z
    .array(
      z.object({
        id: z.string(),
        type: z.string()
      })
    )
    .optional()
});

export const xIncludesSchema = z
  .object({
    users: z.array(xUserSchema).optional(),
    media: z.array(xMediaSchema).optional()
  })
  .partial();

export const xApiResponseSchema = z.object({
  data: z.array(xPostSchema).optional(),
  includes: xIncludesSchema.optional(),
  meta: z
    .object({
      result_count: z.number().optional(),
      next_token: z.string().optional(),
      previous_token: z.string().optional(),
      newest_id: z.string().optional(),
      oldest_id: z.string().optional()
    })
    .partial()
    .optional(),
  errors: z
    .array(
      z.object({
        title: z.string().optional(),
        detail: z.string().optional(),
        type: z.string().optional(),
        parameter: z.string().optional(),
        value: z.string().optional()
      })
    )
    .optional()
});

export const normalizedSourceSchema = z.object({
  platform: z.literal("x"),
  endpoint: z.string(),
  fetched_at: z.string(),
  auth_mode: z.enum(["noauth", "oauth2"]),
  query: z.string().nullable(),
  cursor: z.string().nullable()
});

export const normalizedScopeSchema = z.object({
  account_id: z.string().nullable(),
  account_username: z.string().nullable(),
  time_window: z.string().nullable(),
  limit: z.number().int()
});

export const normalizedRateLimitSchema = z.object({
  limit: z.number().nullable(),
  remaining: z.number().nullable(),
  reset_unix: z.number().nullable()
});

export const normalizedMetaSchema = z.object({
  partial: z.boolean(),
  limitations: z.array(z.string()),
  rate_limit: normalizedRateLimitSchema
});

export const normalizedUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string().nullable(),
  created_at: z.string().nullable(),
  description: z.string().nullable(),
  profile_image_url: z.string().nullable(),
  protected: z.boolean().nullable(),
  verified: z.boolean().nullable(),
  metrics: z
    .object({
      followers_count: z.number().nullable(),
      following_count: z.number().nullable(),
      post_count: z.number().nullable(),
      listed_count: z.number().nullable()
    })
    .strict()
});

export const normalizedMediaSchema = z.object({
  media_key: z.string(),
  type: z.string(),
  url: z.string().nullable(),
  preview_image_url: z.string().nullable(),
  duration_ms: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable()
});

export const normalizedPostSchema = z.object({
  id: z.string(),
  text: z.string(),
  author_id: z.string().nullable(),
  created_at: z.string().nullable(),
  language: z.string().nullable(),
  conversation_id: z.string().nullable(),
  in_reply_to_user_id: z.string().nullable(),
  referenced: z.array(z.object({ id: z.string(), type: z.string() })),
  metrics: z
    .object({
      retweet_count: z.number().nullable(),
      reply_count: z.number().nullable(),
      like_count: z.number().nullable(),
      quote_count: z.number().nullable(),
      bookmark_count: z.number().nullable(),
      impression_count: z.number().nullable()
    })
    .strict(),
  entities: z
    .object({
      hashtags: z.array(z.string()),
      cashtags: z.array(z.string()),
      mentions: z.array(z.string()),
      urls: z.array(z.string())
    })
    .strict()
});

export const normalizedTimelineBundleSchema = z.object({
  source: normalizedSourceSchema,
  scope: normalizedScopeSchema,
  posts: z.array(normalizedPostSchema),
  includes: z.object({
    users: z.array(normalizedUserSchema),
    media: z.array(normalizedMediaSchema)
  }),
  meta: normalizedMetaSchema,
  pagination: z
    .object({
      next_cursor: z.string().nullable(),
      previous_cursor: z.string().nullable()
    })
    .strict()
});

export const normalizedUserLookupResultSchema = z.object({
  source: normalizedSourceSchema,
  users: z.array(normalizedUserSchema),
  meta: normalizedMetaSchema
});

export type NormalizedTimelineBundle = z.infer<typeof normalizedTimelineBundleSchema>;
export type NormalizedUserLookupResult = z.infer<typeof normalizedUserLookupResultSchema>;
