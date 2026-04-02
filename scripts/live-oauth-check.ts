import { loadLiveHarnessConfig, LiveMcpClient, printStep, redactSessionId, summarizeToolResult, validateToolResult, writeSummaryIfRequested, type HarnessStepResult, type LiveHarnessSummary } from "../src/contracts/liveHarness.js";

async function main() {
  const helpRequested = process.argv.includes("--help");
  if (helpRequested) {
    const baseUrl = process.env.LIVE_TEST_BASE_URL ?? "http://localhost:3000";
    printHelp(baseUrl);
    process.exit(0);
    return;
  }
  const config = loadLiveHarnessConfig();
  if (!config.oauthSessionId) {
    if (config.enableOauthManual) {
      printHelp(config.baseUrl);
    } else {
      console.error("LIVE_TEST_OAUTH_SESSION_ID is required for live:oauth:check. Run with --help for the manual workflow.");
    }
    process.exit(1);
    return;
  }

  const steps: HarnessStepResult[] = [];
  console.log(`Live OAuth harness: ${config.baseUrl}`);
  console.log(`oauth_session_id=${redactSessionId(config.oauthSessionId)}`);

  const client = new LiveMcpClient(config.baseUrl, config.mcpPath, config.timeoutMs, config.verbose);
  let init;
  try {
    init = await client.initialize();
  } catch (error) {
    steps.push({
      name: "MCP initialize",
      ok: false,
      detail: `request failed: ${describeError(error)}`,
      suggestion: "Check the server is running and accepts MCP initialize requests"
    });
    finish(config, steps);
    return;
  }
  if (init.error || !init.sessionId) {
    steps.push({
      name: "MCP initialize",
      ok: false,
      detail: init.error
        ? `protocol error ${init.error.code}: ${init.error.message}`
        : "missing mcp-session-id header",
      suggestion: "Check the server is running and accepts MCP initialize requests"
    });
    finish(config, steps);
    return;
  }
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
  steps.push({
    name: "MCP initialize",
    ok: true,
    detail: `session=${redactSessionId(init.sessionId)}`
  });

  let me;
  try {
    me = await client.callTool("x.get_authenticated_user", {
      oauth_session_id: config.oauthSessionId
    });
  } catch (error) {
    steps.push({
      name: "x.get_authenticated_user",
      ok: false,
      detail: `request failed: ${describeError(error)}`,
      suggestion: "Check the OAuth session, scopes, and server logs"
    });
    finish(config, steps);
    return;
  }
  steps.push(summarizeOauthTool("x.get_authenticated_user", me, "users"));
  if (steps.at(-1)?.ok !== true) {
    finish(config, steps);
    return;
  }

  let home;
  try {
    home = await client.callTool("x.get_home_timeline", {
      oauth_session_id: config.oauthSessionId,
      max_results: 5,
      exclude_replies: false,
      exclude_retweets: false
    });
  } catch (error) {
    steps.push({
      name: "x.get_home_timeline",
      ok: false,
      detail: `request failed: ${describeError(error)}`,
      suggestion: "Check the OAuth session, linked account, and server logs"
    });
    finish(config, steps);
    return;
  }
  steps.push(summarizeOauthTool("x.get_home_timeline", home, "posts"));

  finish(config, steps);
}

function summarizeOauthTool(
  name: string,
  envelope: { error?: { code: number; message: string }; result?: unknown },
  fieldName: "users" | "posts"
): HarnessStepResult {
  if (envelope.error) {
    return {
      name,
      ok: false,
      detail: `protocol error ${envelope.error.code}: ${envelope.error.message}`,
      suggestion: "Confirm the MCP session is established and the tool call payload is valid"
    };
  }

  const result = envelope.result;
  const problems = validateToolResult(result);
  const summary = summarizeToolResult(result);
  const structured = extractStructured(result);
  const field = structured && Array.isArray(structured[fieldName]) ? structured[fieldName] : [];
  const authCode = structured?.error && typeof structured.error === "object"
    ? (structured.error as Record<string, unknown>).code
    : null;

  if (problems.length > 0 || summary.isError) {
    return {
      name,
      ok: false,
      detail: `${problems.join(", ") || `tool error ${authCode ?? summary.errorCode ?? "<unknown>"}`}`,
      suggestion: "Check the OAuth session, scope grants, and token freshness"
    };
  }

  return {
    name,
    ok: true,
    detail: `${fieldName}=${field.length}`,
    meta: {
      fieldCount: field.length,
      authCode: summary.errorCode
    }
  };
}

function extractStructured(result: unknown): Record<string, unknown> | null {
  if (typeof result !== "object" || !result || typeof (result as Record<string, unknown>).structuredContent !== "object") {
    return null;
  }
  const structured = (result as Record<string, unknown>).structuredContent;
  return structured && typeof structured === "object" ? (structured as Record<string, unknown>) : null;
}

function printHelp(baseUrl: string): void {
  console.log([
    "Manual OAuth harness",
    "",
    "1. Start the server with the normal environment and a durable session store.",
    `2. Open ${baseUrl}/oauth/x/start in a browser and complete X login.`,
    "3. Copy oauth_session_id from the callback JSON response.",
    "4. Run:",
    "   LIVE_TEST_OAUTH_SESSION_ID=<session-id> npm run live:oauth:check",
    "",
    "Expected success path:",
    " - x.get_authenticated_user returns one user record",
    " - x.get_home_timeline returns a posts array for the linked account",
    "",
    "Expected failure modes:",
    " - AUTH_REQUIRED: session missing, expired, or not linked",
    " - AUTH_SCOPE_MISSING: session lacks required read scopes",
    " - AUTH_TOKEN_INVALID / AUTH_TOKEN_UNVERIFIABLE: token verification failure",
    "",
    "Debugging hints:",
    " - Use npm run live:check first to confirm the MCP transport is alive.",
    " - If the callback returns no oauth_session_id, check /oauth/x/callback logs.",
    " - If home timeline fails, confirm the session has linkedAccount.id and the X token has tweet.read/users.read scopes.",
    " - For wire-level MCP debugging, use MCP Inspector or any JSON-RPC client that can send initialize, notifications/initialized, and tools/call.",
    ""
  ].join("\n"));
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
  console.log(`Summary: ${passed}/${steps.length} passed`);
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
