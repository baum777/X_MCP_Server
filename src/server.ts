import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryTokenStore } from "./auth/tokenStore.js";
import { OAuthTokenVerifier } from "./auth/tokenVerifier.js";
import { XOAuthService } from "./auth/oauth.js";
import { XApiClient } from "./clients/xApiClient.js";
import { loadEnv } from "./config/env.js";
import { buildLogger } from "./lib/logger.js";
import { asAppError } from "./lib/errors.js";
import { buildMcpServer } from "./mcp.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerOAuthRoutes } from "./routes/oauth.js";

const env = loadEnv();
const logger = buildLogger(env);

const tokenStore = new InMemoryTokenStore(env.tokenSessionTtlSeconds);
const tokenVerifier = new OAuthTokenVerifier(env);
const xClient = new XApiClient();
const oauthService = new XOAuthService(env, tokenStore, logger);

const app = express();
app.use(express.json({ limit: "1mb" }));

registerHealthRoutes(app, env);
registerOAuthRoutes(app, {
  oauthService,
  xClient,
  tokenStore,
  logger
});

app.post(env.mcpBasePath, async (req, res) => {
  const requestId = randomUUID();
  const server = buildMcpServer({
    env,
    logger,
    xClient,
    tokenStore,
    tokenVerifier,
    oauthService
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID()
  });

  res.setHeader("x-request-id", requestId);
  transport.onerror = (error) => {
    logger.error({ requestId, error }, "MCP transport error");
  };

  try {
    await server.connect(transport as any);
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
