import type { Express } from "express";
import type { Env } from "../config/env.js";

export function registerHealthRoutes(app: Express, env: Env) {
  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: "x-timeline-mcp",
      version: "0.1.0",
      mcp_path: env.mcpBasePath
    });
  });
}
