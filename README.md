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
- Durable session store abstraction with encrypted token persistence
- Postgres-backed session store as the default runtime mode
- In-memory session store for local/dev only
- Pending OAuth state persistence
- Session lifecycle states: `active`, `expired`, `revoked`, `invalid`
- Session cleanup on startup and a periodic cleanup loop
- Basic tests covering normalization, auth challenge behavior, token verification, and session lifecycle semantics

Not fully production-complete yet:
- No HA/distributed session orchestration
- No production audit sink or observability pipeline
- OAuth end-to-end integration tests against live X are not included
- Opaque access-token handling is mode-based and still depends on the chosen trust boundary
- `in_memory` mode is not durable and should be treated as dev-only
- The OAuth bridge pattern still uses `oauth_session_id` as a caller-supplied session handle; this is not a full native OAuth UX integration

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
- Home timeline: `/2/users/me` then `/2/users/:id/timelines/reverse_chronological`

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
3. Callback exchanges code for token, stores an encrypted session durably when the store is configured for Postgres, and returns `oauth_session_id`.
4. MCP callers provide `oauth_session_id` on OAuth-required tools.
5. In this V1 scaffold, `oauth_session_id` is still a bridge between the OAuth callback and MCP tool calls, not a full native OAuth identity layer.
6. If a tool finds a missing or expired OAuth session, it returns an auth-challenge-ready error with top-level `mcp/www_authenticate` metadata and an `oauth_start_url` hint.
7. Session records are persisted with explicit lifecycle state and are cleaned up explicitly when expired or revoked.

Per OAuth tool call, the server verifies:
- Token expiration
- Required scopes
- Issuer/audience/signature in `strict_jwt` mode when JWKS is configured
- Session-bound opaque-token trust in `opaque_trust_session` mode
- Verification skip in `dev_skip_verify` mode for local-only testing

## Environment Variables

See `.env.example`.

Required in practice:
- `PORT`
- `PUBLIC_BASE_URL`
- `MCP_BASE_PATH`
- `X_CLIENT_ID`
- `X_REDIRECT_URI`
- `X_SCOPES`
- `SESSION_STORE_MODE`
- `SESSION_ENCRYPTION_KEY`
- `LOG_LEVEL`

Conditionally required:
- `X_CLIENT_SECRET` (if confidential-client exchange is required)
- `X_APP_BEARER_TOKEN` (for noauth public-tool execution)
- `X_JWKS_URL` (for JWT signature verification)
- `X_TOKEN_VERIFICATION_MODE` (`strict_jwt`, `opaque_trust_session`, or `dev_skip_verify`)
- `DATABASE_URL` when `SESSION_STORE_MODE=postgres`
- `OAUTH_PENDING_AUTH_TTL_SECONDS`

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

3. Apply the session schema when using Postgres:
```bash
psql "$DATABASE_URL" -f sql/migrations/001_oauth_sessions.sql
```

4. Run dev server:
```bash
npm run dev
```

5. MCP endpoint:
- `POST {PUBLIC_BASE_URL}{MCP_BASE_PATH}` (default `POST http://127.0.0.1:3000/mcp`)

6. Health:
- `GET http://127.0.0.1:3000/healthz`

## Session Store Modes

### `postgres`
Default runtime posture.

- Stores OAuth sessions and pending OAuth state in Postgres
- Encrypts access tokens, refresh tokens, and PKCE verifiers before persistence
- Requires `DATABASE_URL`, `SESSION_STORE_MODE=postgres`, and `SESSION_ENCRYPTION_KEY`
- Fails closed if the schema is missing

### `in_memory`
Development-only bridge mode.

- Uses the same encrypted row format in memory
- Loses sessions on restart
- Not durable and not production-complete
- Useful for local testing when Postgres is unavailable

## Session Lifecycle

- `active`: session can be used after scope, expiry, and token verification checks pass
- `expired`: session exceeded its lifetime and is no longer returned as active
- `revoked`: session was explicitly invalidated and is never returned as active
- `invalid`: session failed a refresh or was otherwise marked unusable

Cleanup behavior:
- Expired and non-active sessions are removed by the cleanup job
- Pending OAuth state is also cleaned up after expiry
- Cleanup runs once at startup and then on a periodic loop

Session access rules:
- Lookup is fail-closed
- Expired sessions are not returned
- Revoked sessions are not returned
- Linked-account hydration persists back to the session store

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
Required string fields are now hard-validated during normalization; if upstream omits a required field, the tool fails with an upstream-data error instead of inventing empty strings.

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
- `tests/authChallenge.test.ts`
- `tests/homeTimelinePath.test.ts`
- `tests/normalizeFailure.test.ts`
- `tests/tokenVerifierMode.test.ts`
- `tests/sessionStore.test.ts`

Run:
```bash
npm test
npm run check
```

## Live Integration Harness

The repository includes a small opt-in live harness for local operator checks.

What it covers:
- `GET /healthz`
- MCP transport reachability and basic `tools/list`
- Safe public/noauth tool calls when explicitly enabled
- One intentional auth-required negative check
- Manual OAuth-assisted verification with a supplied `oauth_session_id`

What it does not cover:
- Full production readiness
- Browser automation
- Continuous monitoring
- Write-side X actions
- Load, resilience, or HA validation

Quick run:
```bash
LIVE_TEST_BASE_URL=http://127.0.0.1:3000 \
LIVE_TEST_ENABLE_PUBLIC_X=true \
LIVE_TEST_QUERY=openai \
npm run live:check
```

Manual OAuth helper:
```bash
LIVE_TEST_BASE_URL=http://127.0.0.1:3000 \
LIVE_TEST_OAUTH_SESSION_ID=<session-id> \
npm run live:oauth:check
```

If you need the operator workflow, environment list, and debugging notes, see [docs/live_integration_harness.md](./docs/live_integration_harness.md).

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

1. Add OAuth integration tests against a controlled X app environment.
2. Add request-level auth context bridging from MCP client identity into token resolution.
3. Add optional cache for safe read endpoints with explicit TTL policy.
4. Add structured audit sink (request provenance + tool invocation logs).
5. Add optional widget/UI layer without changing the core tool contracts.
