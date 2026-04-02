import { z } from "zod";

export const optionalSessionSchema = z.object({
  oauth_session_id: z.string().min(1).optional()
});

export const lookupUsersInputSchema = optionalSessionSchema.extend({
  usernames: z.array(z.string().min(1)).max(50).optional(),
  ids: z.array(z.string().min(1)).max(100).optional()
});

export const searchRecentPostsInputSchema = optionalSessionSchema.extend({
  query: z.string().min(1).max(512),
  max_results: z.number().int().min(10).max(100).default(20),
  next_token: z.string().min(1).optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional()
});

export const getUserTimelineInputSchema = optionalSessionSchema.extend({
  user_id: z.string().min(1),
  max_results: z.number().int().min(5).max(100).default(20),
  pagination_token: z.string().min(1).optional(),
  exclude_replies: z.boolean().default(false),
  exclude_retweets: z.boolean().default(false)
});

export const getPostBatchInputSchema = optionalSessionSchema.extend({
  post_ids: z.array(z.string().min(1)).min(1).max(100)
});

export const oauthSessionInputSchema = z.object({
  oauth_session_id: z.string().min(1)
});

export const getHomeTimelineInputSchema = oauthSessionInputSchema.extend({
  max_results: z.number().int().min(5).max(100).default(20),
  pagination_token: z.string().min(1).optional(),
  exclude_replies: z.boolean().default(false),
  exclude_retweets: z.boolean().default(false)
});

export const buildSnapshotInputSchema = z.object({
  mode: z.enum(["search_recent_posts", "user_timeline", "home_timeline", "post_batch"]),
  oauth_session_id: z.string().min(1).optional(),
  query: z.string().min(1).max(512).optional(),
  user_id: z.string().min(1).optional(),
  post_ids: z.array(z.string().min(1)).max(100).optional(),
  max_results: z.number().int().min(5).max(100).default(20),
  next_token: z.string().min(1).optional(),
  pagination_token: z.string().min(1).optional(),
  exclude_replies: z.boolean().default(false),
  exclude_retweets: z.boolean().default(false),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional()
});
