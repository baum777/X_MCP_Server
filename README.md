# x-timeline-mcp

`x-timeline-mcp` is a remote, read-first MCP server for structured X (Twitter) timeline/search data retrieval in ChatGPT/OpenAI Apps analysis workflows.

V1 scope is intentionally narrow:
- Tool-first MCP surface
- Read-only only
- Mixed-auth capable (public/app-token for public reads, OAuth for user-scoped reads)
- Normalized outputs for downstream timeline analysis

## Operational Honesty

This is a production-honest V1 scaffold, not a "fully production-ready" claim.

Implemented:
- Remote MCP HTTP endpoint with typed tools and schema validation
- Public + OAuth auth split
- OAuth Authorization Code + PKCE start/callback
- Fail-closed OAuth token verification path
- Rate-limit header capture and normalized mapping
- Basic tests (normalization, rate-limit parser, tool-surface sanity)

Not fully production-complete yet:
- Token persistence is in-memory only (no durable encrypted store)
- OAuth end-to-end integration tests against live X are not included
- Opaque access-token verification is limited by token format/JWKS availability
- No distributed session store, no HA orchestration, no audit sink

## Tool Surface (V1)

All tools are read-only and annotated with:
- `readOnlyHint: true`
- `openWorldHint: true`

### 1) `x.lookup_users`
Use this when you need canonical user profiles for one or more X usernames and/or user IDs before timeline or search analysis.

- Auth: public app bearer token OR OAuth session
- Input: `usernames[]` and/or `ids[]`, optional `oauth_session_id`
- Output: normalized user list + source/meta/rate-limit

### 2) `x.search_recent_posts`
Use this when you need last-7-days X search results for keywords, handles, hashtags, cashtags, or narrative phrases.

- Auth: public app bearer token OR OAuth session
- Input: `query`, `max_results`, optional cursor/time window/session
- Output: normalized timeline bundle
- Constraint: recent-search semantics only (no full archive in V1)

### 3) `x.get_user_timeline`
Use this when you need recent posts for a specific X user ID with optional reply/retweet exclusion and pagination.

- Auth: public app bearer token OR OAuth session
- Input: `user_id`, optional exclusion flags + pagination + session
- Output: normalized timeline bundle

### 4) `x.get_post_batch`
Use this when you need to hydrate a known batch of X post IDs after a search or timeline retrieval step.

- Auth: public app bearer token OR OAuth session
- Input: `post_ids[]`, optional session
- Output: normalized timeline bundle

### 5) `x.get_authenticated_user`
Use this when you need to verify which X account is linked to the current OAuth session before user-scoped timeline analysis.

- Auth: OAuth required
- Input: `oauth_session_id`
- Output: normalized user lookup result (single user expected)

### 6) `x.get_home_timeline`
Use this when you need the reverse-chronological home timeline for the OAuth-linked X account.

- Auth: OAuth required
- Input: `oauth_session_id`, optional exclusion flags + pagination
- Output: normalized timeline bundle

### 7) `x.build_timeline_snapshot`
Use this when you need one normalized analysis bundle generated from a search, timeline, home-timeline, or post-batch retrieval flow.

- Auth: mixed depending on mode (`home_timeline` requires OAuth)
- Input: `mode` + mode-specific params
- Output: normalized timeline bundle
- Note: no AI inference in this tool; pure retrieval normalization only

## Supported X API Capabilities (Conceptual Endpoints)

- User lookup: `/2/users`, `/2/users/by`
- Tweet lookup batch: `/2/tweets`
- Recent search: `/2/tweets/search/recent`
- User tweets timeline: `/2/users/:id/tweets`
- Authenticated user: `/2/users/me`
- Home timeline: `/2/users/me/timelines/reverse_chronological`

## Explicitly Unsupported in V1

- Full archive search
- Stream APIs
- Post/create/delete actions
- Follow/like/bookmark actions
- DM/messaging flows
- Any write-side actions of any kind

## Auth Model

### Public/Optional-Auth tools
- `x.lookup_users`
- `x.search_recent_posts`
- `x.get_user_timeline`
- `x.get_post_batch`

These can run without linked-user OAuth if `X_APP_BEARER_TOKEN` is configured.

### OAuth-Required tools
- `x.get_authenticated_user`
- `x.get_home_timeline`

OAuth flow:
1. Start at `GET /oauth/x/start` (redirects to X authorize URL with PKCE).
2. X redirects to `X_REDIRECT_URI` (default `GET /oauth/x/callback`).
3. Callback exchanges code for token, stores session, and returns `oauth_session_id`.
4. MCP callers provide `oauth_session_id` on OAuth-required tools.

Per OAuth tool call, the server verifies:
- Token expiration
- Required scopes
- Issuer/audience/signature when token is JWT and JWKS is configured
- Fail-closed behavior for opaque tokens unless explicitly overridden

## Environment Variables

See `.env.example`.

Required in practice:
- `PORT`
- `PUBLIC_BASE_URL`
- `MCP_BASE_PATH`
- `X_CLIENT_ID`
- `X_REDIRECT_URI`
- `X_SCOPES`
- `SESSION_SECRET`
- `LOG_LEVEL`

Conditionally required:
- `X_CLIENT_SECRET` (if confidential-client exchange is required)
- `X_APP_BEARER_TOKEN` (for noauth public-tool execution)
- `X_JWKS_URL` (for JWT signature verification)

## Local Setup

1. Install dependencies:
```bash
npm install
```

2. Configure env:
```bash
cp .env.example .env
```
Then fill required values.

3. Run dev server:
```bash
npm run dev
```

4. MCP endpoint:
- `POST {PUBLIC_BASE_URL}{MCP_BASE_PATH}` (default `POST http://localhost:3000/mcp`)

5. Health:
- `GET http://localhost:3000/healthz`

## Output Contract Notes

Timeline-oriented tools normalize into this shape:
- `source` (platform/endpoint/fetch timestamp/auth/query/cursor)
- `scope` (account and retrieval scope info)
- `posts` (normalized post objects)
- `includes.users`, `includes.media`
- `meta.partial`, `meta.limitations`, `meta.rate_limit`
- `pagination.next_cursor`, `pagination.previous_cursor`

User lookup normalizes into:
- `source`
- `users[]`
- `meta` with normalized rate-limit + limitation fields

Server does not fabricate unavailable metrics or fields.

## Error and Rate-Limit Behavior

- `429`: mapped to `UPSTREAM_RATE_LIMITED` with reset metadata when available.
- `401/403`: mapped to explicit auth/scope/access errors.
- `400`: mapped to validation-oriented upstream error with payload details.
- Network failures: mapped to `NETWORK_ERROR` with retryability signal.
- No silent failures; structured error payloads are returned.

## Testing

Current tests:
- `tests/rateLimit.test.ts`
- `tests/normalize.test.ts`
- `tests/toolCatalog.test.ts`

Run:
```bash
npm test
npm run check
```

## File Structure

```text
src/
  auth/
  clients/
  config/
  contracts/
  lib/
  routes/
  tools/
  mcp.ts
  server.ts
tests/
.env.example
README.md
package.json
tsconfig.json
```

## Roadmap (Next Steps)

1. Add durable encrypted token/session storage (DB or KMS-backed secret store).
2. Add OAuth integration tests against a controlled X app environment.
3. Add request-level auth context bridging from MCP client identity into token resolution.
4. Add optional cache for safe read endpoints with explicit TTL policy.
5. Add structured audit sink (request provenance + tool invocation logs).
6. Add optional widget/UI layer without changing the core tool contracts.
