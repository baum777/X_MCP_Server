# Live Integration Harness

This harness is a small operator-facing check layer for the current V1 X Timeline MCP server.

It is meant for:
- local confidence before manual use
- quick debugging of server boot and transport issues
- lightweight live verification against real upstream X config when available

It is not meant for:
- CI gating
- load testing
- browser automation
- production readiness proof
- a substitute for the unit test suite

## Automated Lane

Run:

```bash
LIVE_TEST_BASE_URL=http://localhost:3000 npm run live:check
```

Optional environment variables:
- `LIVE_TEST_MCP_PATH` default `/mcp`
- `LIVE_TEST_HEALTH_PATH` default `/healthz`
- `LIVE_TEST_ENABLE_PUBLIC_X` default `false`
- `LIVE_TEST_ENABLE_OAUTH_MANUAL` default `false`
- `LIVE_TEST_QUERY` default `openai`
- `LIVE_TEST_LOOKUP_USERNAME` default `jack`
- `LIVE_TEST_USER_ID` optional
- `LIVE_TEST_POST_IDS` optional comma/space separated list
- `LIVE_TEST_TIMEOUT_MS` default `15000`
- `LIVE_TEST_VERBOSE` default `false`
- `LIVE_TEST_SUMMARY_PATH` optional JSON artifact path

What it checks:
1. `GET /healthz` returns the expected JSON shape.
2. The MCP endpoint accepts `initialize`, returns a session id, and accepts `tools/list`.
3. `x.get_home_timeline` fails closed when given a bogus session id.
4. If `LIVE_TEST_ENABLE_PUBLIC_X=true`, safe public/noauth tool calls are exercised:
   - `x.lookup_users`
   - `x.search_recent_posts`
   - `x.get_user_timeline` when `LIVE_TEST_USER_ID` is set
   - `x.get_post_batch` when `LIVE_TEST_POST_IDS` is set

Expected output:
- one line per check
- `PASS` or `FAIL`
- short parameter summary
- result counts when applicable
- a suggested next debugging step on failures

If a public tool fails with `AUTH_REQUIRED`, `AUTH_TOKEN_INVALID`, or `UPSTREAM_RATE_LIMITED`, the harness reports the failure honestly. It does not retry or hide the upstream condition.

## Manual OAuth Lane

Run:

```bash
LIVE_TEST_BASE_URL=http://localhost:3000 \
LIVE_TEST_OAUTH_SESSION_ID=<session-id> \
npm run live:oauth:check
```

If you need the step-by-step workflow:

```bash
npm run live:oauth:help
```

Manual flow:
1. Start the server normally.
2. Open `http://localhost:3000/oauth/x/start`.
3. Complete X login in the browser.
4. Copy `oauth_session_id` from the callback JSON response.
5. Run the helper with that session id.

The helper exercises:
- `x.get_authenticated_user`
- `x.get_home_timeline`

Expected outcomes:
- `x.get_authenticated_user` returns one linked user record.
- `x.get_home_timeline` returns a posts array for the linked account.

Expected failures:
- `AUTH_REQUIRED` for missing, expired, or revoked sessions
- `AUTH_SCOPE_MISSING` when the OAuth grant lacks read scopes
- `AUTH_TOKEN_INVALID` or `AUTH_TOKEN_UNVERIFIABLE` when the token mode does not match the runtime trust boundary

## MCP Inspector / Manual Wire Checks

If the live harness cannot parse the MCP transport, use an MCP Inspector or any JSON-RPC client that can send:
1. `initialize`
2. `notifications/initialized`
3. `tools/list`
4. `tools/call`

The harness uses the same sequence and reuses the `mcp-session-id` header returned by `initialize`.

## Confidence Boundary

Passing the harness means:
- the local server boots
- the health and MCP routes are live
- the MCP wire shape works for this runtime
- selected safe tool calls are behaving as expected

It does not mean:
- X is healthy globally
- the OAuth integration is production-complete
- the server is resilient under load
- the deployment is production-ready
