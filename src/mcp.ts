import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";
import type { ToolContext } from "./tools/shared.js";

export function buildMcpServer(ctx: ToolContext) {
  const server = new McpServer({
    name: "x-timeline-mcp",
    version: "0.1.0"
  });

  registerAllTools(server, ctx);
  return server;
}
