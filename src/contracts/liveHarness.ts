import { z } from "zod";

export const MCP_PROTOCOL_VERSION = "2025-03-26";

const liveHarnessEnvSchema = z.object({
  LIVE_TEST_BASE_URL: z.string().url(),
  LIVE_TEST_MCP_PATH: z.string().min(1).default("/mcp"),
  LIVE_TEST_HEALTH_PATH: z.string().min(1).default("/healthz"),
  LIVE_TEST_ENABLE_PUBLIC_X: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => parseBoolean(value, false))
    .default(false),
  LIVE_TEST_ENABLE_OAUTH_MANUAL: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => parseBoolean(value, false))
    .default(false),
  LIVE_TEST_QUERY: z.string().min(1).default("openai"),
  LIVE_TEST_LOOKUP_USERNAME: z.string().min(1).default("jack"),
  LIVE_TEST_USER_ID: z.string().min(1).optional(),
  LIVE_TEST_POST_IDS: z.string().min(1).optional(),
  LIVE_TEST_OAUTH_SESSION_ID: z.string().min(1).optional(),
  LIVE_TEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  LIVE_TEST_VERBOSE: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => parseBoolean(value, false))
    .default(false),
  LIVE_TEST_SUMMARY_PATH: z.string().min(1).optional()
});

export type LiveHarnessConfig = {
  baseUrl: string;
  mcpPath: string;
  healthPath: string;
  enablePublicX: boolean;
  enableOauthManual: boolean;
  query: string;
  lookupUsername: string;
  userId: string | null;
  postIds: string[];
  oauthSessionId: string | null;
  timeoutMs: number;
  verbose: boolean;
  summaryPath: string | null;
};

export type HarnessStepResult = {
  name: string;
  ok: boolean;
  detail: string;
  suggestion?: string;
  meta?: Record<string, unknown>;
};

export type LiveHarnessSummary = {
  ok: boolean;
  baseUrl: string;
  generatedAt: string;
  steps: HarnessStepResult[];
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
};

type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

type JsonRpcEnvelope = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
};

export function loadLiveHarnessConfig(env: NodeJS.ProcessEnv = process.env): LiveHarnessConfig {
  const raw = liveHarnessEnvSchema.parse(env);
  const postIds = raw.LIVE_TEST_POST_IDS ? raw.LIVE_TEST_POST_IDS.split(/[\s,]+/).filter(Boolean) : [];
  return {
    baseUrl: raw.LIVE_TEST_BASE_URL.replace(/\/+$/, ""),
    mcpPath: normalizePath(raw.LIVE_TEST_MCP_PATH),
    healthPath: normalizePath(raw.LIVE_TEST_HEALTH_PATH),
    enablePublicX: raw.LIVE_TEST_ENABLE_PUBLIC_X,
    enableOauthManual: raw.LIVE_TEST_ENABLE_OAUTH_MANUAL,
    query: raw.LIVE_TEST_QUERY,
    lookupUsername: raw.LIVE_TEST_LOOKUP_USERNAME,
    userId: raw.LIVE_TEST_USER_ID ?? null,
    postIds,
    oauthSessionId: raw.LIVE_TEST_OAUTH_SESSION_ID ?? null,
    timeoutMs: raw.LIVE_TEST_TIMEOUT_MS,
    verbose: raw.LIVE_TEST_VERBOSE,
    summaryPath: raw.LIVE_TEST_SUMMARY_PATH ?? null
  };
}

export class LiveMcpClient {
  private sessionId: string | null = null;
  private requestSeq = 1;

  constructor(
    private readonly baseUrl: string,
    private readonly mcpPath: string,
    private readonly timeoutMs: number,
    private readonly verbose: boolean
  ) {}

  get mcpSessionId(): string | null {
    return this.sessionId;
  }

  async initialize(): Promise<JsonRpcEnvelope & { sessionId: string | null }> {
    const response = await this.postJsonRpc(
      {
        jsonrpc: "2.0",
        id: this.requestSeq++,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: "x-timeline-live-harness",
            version: "0.1.0"
          }
        }
      },
      null
    );
    this.sessionId = response.sessionId;
    return response;
  }

  async sendInitializedNotification(): Promise<void> {
    await this.postJsonRpc(
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {}
      },
      null,
      true
    );
  }

  async listTools(): Promise<JsonRpcEnvelope> {
    return this.postJsonRpc({
      jsonrpc: "2.0",
      id: this.requestSeq++,
      method: "tools/list",
      params: {}
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<JsonRpcEnvelope> {
    return this.postJsonRpc({
      jsonrpc: "2.0",
      id: this.requestSeq++,
      method: "tools/call",
      params: {
        name,
        arguments: args
      }
    });
  }

  async callToolWithSession(
    name: string,
    args: Record<string, unknown>,
    sessionId: string | null = this.sessionId
  ): Promise<JsonRpcEnvelope> {
    return this.postJsonRpc(
      {
        jsonrpc: "2.0",
        id: this.requestSeq++,
        method: "tools/call",
        params: {
          name,
          arguments: args
        }
      },
      sessionId
    );
  }

  async postJsonRpc(request: JsonRpcRequest, useSessionId: string | null = this.sessionId, notification = false): Promise<JsonRpcEnvelope & { sessionId: string | null }> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION
    };
    if (useSessionId) {
      headers["mcp-session-id"] = useSessionId;
    }

  try {
      const response = await fetch(`${this.baseUrl}${this.mcpPath}`, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: controller.signal
      });
      const sessionId = response.headers.get("mcp-session-id");
      const envelope = notification
        ? ({ jsonrpc: "2.0" } as JsonRpcEnvelope)
        : await readJsonRpcResponse(response);
      return {
        ...envelope,
        sessionId: sessionId ?? null
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function redactSessionId(sessionId: string | null | undefined): string {
  if (!sessionId) {
    return "<none>";
  }
  if (sessionId.length <= 10) {
    return `${sessionId.slice(0, 4)}…`;
  }
  return `${sessionId.slice(0, 6)}…${sessionId.slice(-4)}`;
}

export function summarizeToolResult(result: unknown): {
  isError: boolean;
  contentCount: number;
  structuredKeys: string[];
  errorCode: string | null;
  authStartUrl: string | null;
} {
  if (typeof result !== "object" || !result) {
    return {
      isError: true,
      contentCount: 0,
      structuredKeys: [],
      errorCode: null,
      authStartUrl: null
    };
  }
  const record = result as Record<string, unknown>;
  const structured = typeof record.structuredContent === "object" && record.structuredContent ? (record.structuredContent as Record<string, unknown>) : null;
  const error = structured?.error && typeof structured.error === "object" ? (structured.error as Record<string, unknown>) : null;
  const auth = error?.details && typeof error.details === "object"
    ? ((error.details as Record<string, unknown>).auth as Record<string, unknown> | undefined)
    : undefined;
  return {
    isError: Boolean(record.isError),
    contentCount: Array.isArray(record.content) ? record.content.length : 0,
    structuredKeys: structured ? Object.keys(structured) : [],
    errorCode: typeof error?.code === "string" ? error.code : null,
    authStartUrl: typeof auth?.oauth_start_url === "string" ? auth.oauth_start_url : null
  };
}

export function validateToolResult(result: unknown): string[] {
  const problems: string[] = [];
  if (typeof result !== "object" || !result) {
    return ["result is not an object"];
  }
  const record = result as Record<string, unknown>;
  if (!Array.isArray(record.content)) {
    problems.push("missing content array");
  }
  if (record.isError === true) {
    problems.push("tool returned isError=true");
  }
  if (typeof record.structuredContent !== "object" || !record.structuredContent) {
    problems.push("missing structuredContent object");
  }
  return problems;
}

export async function writeSummaryIfRequested(summary: LiveHarnessSummary, summaryPath: string | null): Promise<void> {
  if (!summaryPath) {
    return;
  }
  const fs = await import("node:fs/promises");
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

export function printStep(step: HarnessStepResult): void {
  const status = step.ok ? "PASS" : "FAIL";
  const suffix = step.suggestion ? ` | next: ${step.suggestion}` : "";
  console.log(`[${status}] ${step.name} - ${step.detail}${suffix}`);
}

export function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

async function readJsonRpcResponse(response: Response): Promise<JsonRpcEnvelope> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return readJsonRpcFromSse(response);
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text.trim().length > 0) {
    try {
      if (contentType.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
        parsed = JSON.parse(text);
      } else {
        parsed = tryParseFirstSseMessage(text);
      }
    } catch (error) {
      return {
        jsonrpc: "2.0",
        error: {
          code: -1,
          message: `Failed to parse MCP response body: ${error instanceof Error ? error.message : "unknown"}`,
          data: text.slice(0, 1000)
        }
      };
    }
  }

  if (!response.ok) {
    return {
      jsonrpc: "2.0",
      error: {
        code: response.status,
        message: `HTTP ${response.status}: ${response.statusText}`,
        data: parsed
      }
    };
  }

  if (Array.isArray(parsed)) {
    const first = parsed.find((item) => typeof item === "object" && item && ("result" in item || "error" in item));
    if (first && typeof first === "object") {
      return first as JsonRpcEnvelope;
    }
  }
  if (typeof parsed === "object" && parsed) {
    if ("result" in parsed || "error" in parsed) {
      return parsed as JsonRpcEnvelope;
    }
  }

  return {
    jsonrpc: "2.0",
    error: {
      code: -1,
      message: "Empty or unrecognized MCP response body.",
      data: parsed
    }
  };
}

async function readJsonRpcFromSse(response: Response): Promise<JsonRpcEnvelope> {
  const reader = response.body?.getReader();
  if (!reader) {
    return {
      jsonrpc: "2.0",
      error: {
        code: -1,
        message: "SSE response body is not readable."
      }
    };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
      }
      const parsed = tryParseFirstSseMessage(buffer);
      if (parsed) {
        await reader.cancel().catch(() => undefined);
        return parsed;
      }
      if (done) {
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return {
    jsonrpc: "2.0",
    error: {
      code: -1,
      message: "Empty or unrecognized MCP SSE response body."
    }
  };
}

function tryParseFirstSseMessage(buffer: string): JsonRpcEnvelope | null {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split(/\n\n+/);
  for (let index = 0; index < blocks.length - 1; index += 1) {
    const block = blocks[index] ?? "";
    const data = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) {
      continue;
    }
    try {
      const parsed = JSON.parse(data) as JsonRpcEnvelope;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}
