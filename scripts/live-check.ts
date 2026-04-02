import { loadLiveHarnessConfig, LiveMcpClient, printStep, redactSessionId, summarizeToolResult, validateToolResult, writeSummaryIfRequested, type HarnessStepResult, type LiveHarnessSummary } from "../src/contracts/liveHarness.js";

async function main() {
  const config = loadLiveHarnessConfig();
  const steps: HarnessStepResult[] = [];
  console.log(`Live harness: ${config.baseUrl}`);

  steps.push(await checkHealth(config.baseUrl, config.healthPath));

  const client = new LiveMcpClient(config.baseUrl, config.mcpPath, config.timeoutMs, config.verbose);
  let init;
  try {
    init = await client.initialize();
  } catch (error) {
    steps.push({
      name: "MCP initialize",
      ok: false,
      detail: `request failed: ${describeError(error)}`,
      suggestion: `Check ${config.baseUrl}${config.mcpPath} and verify the server is running`
    });
    finish(config, steps);
    return;
  }
  if (init.error) {
    steps.push({
      name: "MCP initialize",
      ok: false,
      detail: `protocol error ${init.error.code}: ${init.error.message}`,
      suggestion: `Check ${config.baseUrl}${config.mcpPath} and verify the server is running`
    });
    finish(config, steps);
    return;
  }
  if (!init.sessionId) {
    steps.push({
      name: "MCP initialize",
      ok: false,
      detail: "missing mcp-session-id header in initialize response",
      suggestion: "Confirm the MCP transport is running in stateful mode"
    });
    finish(config, steps);
    return;
  }
  steps.push({
    name: "MCP initialize",
    ok: true,
    detail: `session=${redactSessionId(init.sessionId)}`
  });
  try {
    await client.sendInitializedNotification();
  } catch (error) {
    steps.push({
      name: "MCP notifications/initialized",
      ok: false,
      detail: `request failed: ${describeError(error)}`,
      suggestion: "Check the MCP transport session handling and server logs"
    });
    finish(config, steps);
    return;
  }

  let tools;
  try {
    tools = await client.listTools();
  } catch (error) {
    steps.push({
      name: "MCP tools/list",
      ok: false,
      detail: `request failed: ${describeError(error)}`,
      suggestion: "Verify the server booted and the MCP transport accepted the initialized session"
    });
    finish(config, steps);
    return;
  }
  if (tools.error) {
    steps.push({
      name: "MCP tools/list",
      ok: false,
      detail: `protocol error ${tools.error.code}: ${tools.error.message}`,
      suggestion: "Verify the server booted and the MCP transport accepted the initialized session"
    });
    finish(config, steps);
    return;
  }
  const toolList = extractToolNames(tools.result);
  const requiredTools = ["x.lookup_users", "x.search_recent_posts", "x.get_home_timeline"];
  const missingTools = requiredTools.filter((tool) => !toolList.includes(tool));
  steps.push({
    name: "MCP tools/list",
    ok: missingTools.length === 0,
    detail: missingTools.length === 0
      ? `tools=${toolList.length}`
      : `missing=${missingTools.join(", ")}`,
    suggestion: missingTools.length > 0 ? "Check tool registration in src/tools/index.ts" : undefined,
    meta: { toolCount: toolList.length }
  });

  const authNegative = await client.callTool("x.get_home_timeline", {
    oauth_session_id: "__missing_session__",
    max_results: 5,
    exclude_replies: false,
    exclude_retweets: false
  });
  steps.push(validateAuthNegative(authNegative));

  if (config.enablePublicX) {
    steps.push(await runPublicLookupCheck(client, config.lookupUsername));
    steps.push(await runPublicSearchCheck(client, config.query));
    if (config.userId) {
      steps.push(await runPublicUserTimelineCheck(client, config.userId));
    } else {
      steps.push({
        name: "Public x.get_user_timeline",
        ok: true,
        detail: "skipped (LIVE_TEST_USER_ID not set)"
      });
    }
    if (config.postIds.length > 0) {
      steps.push(await runPublicPostBatchCheck(client, config.postIds));
    } else {
      steps.push({
        name: "Public x.get_post_batch",
        ok: true,
        detail: "skipped (LIVE_TEST_POST_IDS not set)"
      });
    }
  } else {
    steps.push({
      name: "Public X checks",
      ok: true,
      detail: "skipped (LIVE_TEST_ENABLE_PUBLIC_X=false)"
    });
  }

  finish(config, steps);
}

function validateAuthNegative(envelope: { error?: { code: number; message: string }; result?: unknown }): HarnessStepResult {
  if (envelope.error) {
    return {
      name: "Negative auth check",
      ok: false,
      detail: `protocol error ${envelope.error.code}: ${envelope.error.message}`,
      suggestion: "Use a bogus oauth_session_id and verify tool-level auth handling instead of transport rejection"
    };
  }
  const result = envelope.result;
  const summary = summarizeToolResult(result);
  const structured = extractStructured(result);
  const authStartUrl = summary.authStartUrl;
  const meta = extractMeta(result);
  const wwwAuthenticate = Array.isArray(meta?.["mcp/www_authenticate"])
    ? meta?.["mcp/www_authenticate"]
    : null;
  const authHeaderPresent = Array.isArray(wwwAuthenticate) && wwwAuthenticate.length > 0;
  const authDetails = structured?.error?.details as Record<string, unknown> | undefined;
  const oauthStartUrl = typeof authDetails?.auth === "object" && authDetails.auth
    ? (authDetails.auth as Record<string, unknown>).oauth_start_url
    : null;
  const ok = summary.isError && summary.errorCode === "AUTH_REQUIRED" && (authHeaderPresent || typeof authStartUrl === "string" || typeof oauthStartUrl === "string");
  return {
    name: "Negative auth check",
    ok,
    detail: ok
      ? `code=${summary.errorCode ?? "<missing>"} auth_hint=${authStartUrl ? "yes" : "no"}`
      : `expected AUTH_REQUIRED, got ${summary.errorCode ?? "<missing>"}; top-level challenge=${authHeaderPresent ? "yes" : "no"}`,
    suggestion: ok ? undefined : "Check src/tools/shared.ts auth-error wiring and the MCP tool response envelope",
    meta: {
      errorCode: summary.errorCode,
      authStartUrl: authStartUrl ?? oauthStartUrl ?? null
    }
  };
}

async function runPublicLookupCheck(client: LiveMcpClient, username: string): Promise<HarnessStepResult> {
  try {
    const envelope = await client.callTool("x.lookup_users", {
      usernames: [username]
    });
    return summarizePublicCheck("x.lookup_users", envelope, `username=${username}`, "users");
  } catch (error) {
    return {
      name: "x.lookup_users",
      ok: false,
      detail: `request failed: ${describeError(error)}`,
      suggestion: "Check the public X configuration and server logs"
    };
  }
}

async function runPublicSearchCheck(client: LiveMcpClient, query: string): Promise<HarnessStepResult> {
  try {
    const envelope = await client.callTool("x.search_recent_posts", {
      query,
      max_results: 10
    });
    return summarizePublicCheck("x.search_recent_posts", envelope, `query=${JSON.stringify(query)}`, "posts");
  } catch (error) {
    return {
      name: "x.search_recent_posts",
      ok: false,
      detail: `request failed: ${describeError(error)}`,
      suggestion: "Check the public X configuration and server logs"
    };
  }
}

async function runPublicUserTimelineCheck(client: LiveMcpClient, userId: string): Promise<HarnessStepResult> {
  try {
    const envelope = await client.callTool("x.get_user_timeline", {
      user_id: userId,
      max_results: 10,
      exclude_replies: false,
      exclude_retweets: false
    });
    return summarizePublicCheck("x.get_user_timeline", envelope, `user_id=${userId}`, "posts");
  } catch (error) {
    return {
      name: "x.get_user_timeline",
      ok: false,
      detail: `request failed: ${describeError(error)}`,
      suggestion: "Check the public X configuration and server logs"
    };
  }
}

async function runPublicPostBatchCheck(client: LiveMcpClient, postIds: string[]): Promise<HarnessStepResult> {
  try {
    const envelope = await client.callTool("x.get_post_batch", {
      post_ids: postIds
    });
    return summarizePublicCheck("x.get_post_batch", envelope, `post_ids=${postIds.length}`, "posts");
  } catch (error) {
    return {
      name: "x.get_post_batch",
      ok: false,
      detail: `request failed: ${describeError(error)}`,
      suggestion: "Check the public X configuration and server logs"
    };
  }
}

function summarizePublicCheck(
  name: string,
  envelope: { error?: { code: number; message: string }; result?: unknown },
  parameterSummary: string,
  fieldName: "users" | "posts"
): HarnessStepResult {
  if (envelope.error) {
    return {
      name,
      ok: false,
      detail: `protocol error ${envelope.error.code}: ${envelope.error.message}`,
      suggestion: "Check the MCP session and the server logs for tool registration or transport errors"
    };
  }

  const result = envelope.result;
  const problems = validateToolResult(result);
  const summary = summarizeToolResult(result);
  const structured = extractStructured(result);
  const field = structured && Array.isArray(structured[fieldName]) ? structured[fieldName] : [];
  const endpoint = structured && typeof structured.source === "object" && structured.source
    ? (structured.source as Record<string, unknown>).endpoint
    : null;

  if (problems.length > 0 || summary.isError) {
    return {
      name,
      ok: false,
      detail: `${parameterSummary} failed: ${problems.join(", ") || `tool error ${summary.errorCode ?? "<unknown>"}`}`,
      suggestion: "Confirm X app bearer token, query safety, and upstream X rate-limit/auth state",
      meta: { errorCode: summary.errorCode }
    };
  }

  return {
    name,
    ok: true,
    detail: `${parameterSummary} ${fieldName}=${field.length}${endpoint ? ` endpoint=${endpoint}` : ""}`,
    meta: {
      fieldCount: field.length,
      endpoint
    }
  };
}

function extractToolNames(result: unknown): string[] {
  if (typeof result !== "object" || !result || !Array.isArray((result as Record<string, unknown>).tools)) {
    return [];
  }
  const tools = (result as Record<string, unknown>).tools as Array<{ name?: unknown }>;
  return tools.map((tool) => (typeof tool.name === "string" ? tool.name : "")).filter(Boolean);
}

function extractStructured(result: unknown): Record<string, unknown> | null {
  if (typeof result !== "object" || !result || typeof (result as Record<string, unknown>).structuredContent !== "object") {
    return null;
  }
  const structured = (result as Record<string, unknown>).structuredContent;
  return structured && typeof structured === "object" ? (structured as Record<string, unknown>) : null;
}

function extractMeta(result: unknown): Record<string, unknown> | null {
  if (typeof result !== "object" || !result || typeof (result as Record<string, unknown>)._meta !== "object") {
    return null;
  }
  const meta = (result as Record<string, unknown>)._meta;
  return meta && typeof meta === "object" ? (meta as Record<string, unknown>) : null;
}

async function checkHealth(baseUrl: string, healthPath: string): Promise<HarnessStepResult> {
  try {
    const response = await fetch(`${baseUrl}${healthPath}`, {
      headers: { accept: "application/json" }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        name: "Health check",
        ok: false,
        detail: `HTTP ${response.status}: ${response.statusText}`,
        suggestion: "Check server startup logs and the health route"
      };
    }
    const ok = typeof payload === "object" && payload && (payload as Record<string, unknown>).ok === true;
    return {
      name: "Health check",
      ok,
      detail: ok ? `ok service=${stringField(payload, "service")} path=${stringField(payload, "mcp_path")}` : "unexpected health payload shape",
      suggestion: ok ? undefined : "Verify GET /healthz returns { ok: true, service, version, mcp_path }",
      meta: { payload }
    };
  } catch (error) {
    return {
      name: "Health check",
      ok: false,
      detail: `request failed: ${error instanceof Error ? error.message : "unknown"}`,
      suggestion: "Confirm the server is listening on the configured base URL"
    };
  }
}

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== "object" || !value || typeof (value as Record<string, unknown>)[key] !== "string") {
    return null;
  }
  return (value as Record<string, string>)[key];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function finish(config: ReturnType<typeof loadLiveHarnessConfig>, steps: HarnessStepResult[]): void {
  for (const step of steps) {
    printStep(step);
  }
  const summary: LiveHarnessSummary = {
    ok: steps.every((step) => step.ok),
    baseUrl: config.baseUrl,
    generatedAt: new Date().toISOString(),
    steps
  };
  void writeSummaryIfRequested(summary, config.summaryPath);
  const passed = steps.filter((step) => step.ok).length;
  const total = steps.length;
  console.log(`Summary: ${passed}/${total} passed`);
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
