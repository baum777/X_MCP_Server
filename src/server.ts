import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createSessionStore } from "./auth/tokenStore.js";
import { OAuthTokenVerifier } from "./auth/tokenVerifier.js";
import { XOAuthService } from "./auth/oauth.js";
import { XApiClient } from "./clients/xApiClient.js";
import { loadEnv } from "./config/env.js";
import { asAppError } from "./lib/errors.js";
import { buildLogger } from "./lib/logger.js";
import { buildMcpServer } from "./mcp.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerOAuthRoutes } from "./routes/oauth.js";

async function main() {
  const env = loadEnv();
  const logger = buildLogger(env);
  const tokenStore = createSessionStore(env, logger);
  await tokenStore.initialize();

  const tokenVerifier = new OAuthTokenVerifier(env);
  const xClient = new XApiClient();
  const oauthService = new XOAuthService(env, tokenStore, logger);
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const mcpTransports = new Map<string, StreamableHTTPServerTransport>();

  registerHealthRoutes(app, env);
  registerOAuthRoutes(app, {
    oauthService,
    xClient,
    tokenStore,
    logger
  });

  app.post(env.mcpBasePath, async (req, res) => {
    const requestId = randomUUID();
    const sessionId = getHeaderValue(req.headers["mcp-session-id"]);
    const isInitializeRequest = isInitializeJsonRpcRequest(req.body);
    const transport = sessionId ? mcpTransports.get(sessionId) : null;

    res.setHeader("x-request-id", requestId);

    if (!transport) {
      if (!isInitializeRequest) {
        res.status(400).json({
          ok: false,
          code: "BAD_REQUEST",
          message: sessionId ? "Unknown MCP session." : "MCP session is required.",
          details: null
        });
        return;
      }

      const nextTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          mcpTransports.set(newSessionId, nextTransport);
        },
        onsessionclosed: (closedSessionId) => {
          mcpTransports.delete(closedSessionId);
        }
      });
      const mcpServer = buildMcpServer({
        env,
        logger,
        xClient,
        tokenStore,
        tokenVerifier,
        oauthService
      });
      nextTransport.onerror = (error) => {
        logger.error({ requestId, error }, "MCP transport error");
      };

      try {
        await mcpServer.connect(nextTransport as any);
        await nextTransport.handleRequest(req, res, req.body);
      } catch (error) {
        const appError = asAppError(error);
        logger.error({ requestId, error }, "MCP request failed");
        if (!res.headersSent) {
          res.status(appError.status).json({
            ok: false,
            code: appError.code,
            message: appError.message,
            details: appError.details ?? null
          });
        }
      }
      return;
    }

    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const appError = asAppError(error);
      logger.error({ requestId, error }, "MCP request failed");
      if (!res.headersSent) {
        res.status(appError.status).json({
          ok: false,
          code: appError.code,
          message: appError.message,
          details: appError.details ?? null
        });
      }
    }
  });

  app.listen(env.port, () => {
    logger.info(
      {
        port: env.port,
        mcp_path: env.mcpBasePath
      },
      "x-timeline-mcp listening"
    );
  });

  const cleanupIntervalMs = 15 * 60 * 1000;
  const cleanupHandle = setInterval(() => {
    void tokenStore.deleteExpiredSessions().catch((error) => {
      logger.warn({ error }, "Session cleanup failed");
    });
  }, cleanupIntervalMs);
  cleanupHandle.unref?.();

  void tokenStore.deleteExpiredSessions().catch((error) => {
    logger.warn({ error }, "Initial session cleanup failed");
  });
}

function getHeaderValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string" && value[0].length > 0) {
    return value[0];
  }
  return null;
}

function isInitializeJsonRpcRequest(body: unknown): boolean {
  if (typeof body !== "object" || !body || Array.isArray(body)) {
    return false;
  }
  const request = body as Record<string, unknown>;
  return request.jsonrpc === "2.0" && request.method === "initialize";
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unhandled startup error.";
  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(1);
});
