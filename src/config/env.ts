import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url(),
  MCP_BASE_PATH: z.string().min(1).default("/mcp"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  X_CLIENT_ID: z.string().min(1),
  X_CLIENT_SECRET: z.string().min(1).optional(),
  X_REDIRECT_URI: z.string().url(),
  X_SCOPES: z.string().min(1).default("tweet.read users.read offline.access"),
  X_OAUTH_AUTHORIZE_URL: z.string().url().default("https://twitter.com/i/oauth2/authorize"),
  X_OAUTH_TOKEN_URL: z.string().url().default("https://api.x.com/2/oauth2/token"),
  X_ISSUER: z.string().min(1).default("https://api.x.com"),
  X_AUDIENCE: z.string().min(1).default("api.x.com"),
  X_JWKS_URL: z.string().url().optional(),
  X_APP_BEARER_TOKEN: z.string().min(1).optional(),

  SESSION_SECRET: z.string().min(16),
  ALLOW_OPAQUE_X_ACCESS_TOKEN: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  TOKEN_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(86400)
});

export type Env = {
  port: number;
  publicBaseUrl: string;
  mcpBasePath: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  xClientId: string;
  xClientSecret: string | null;
  xRedirectUri: string;
  xScopes: string[];
  xAuthorizeUrl: string;
  xTokenUrl: string;
  xIssuer: string;
  xAudience: string;
  xJwksUrl: string | null;
  xAppBearerToken: string | null;
  sessionSecret: string;
  allowOpaqueXAccessToken: boolean;
  tokenSessionTtlSeconds: number;
};

export function loadEnv(): Env {
  const raw = envSchema.parse(process.env);
  return {
    port: raw.PORT,
    publicBaseUrl: raw.PUBLIC_BASE_URL,
    mcpBasePath: raw.MCP_BASE_PATH,
    logLevel: raw.LOG_LEVEL,
    xClientId: raw.X_CLIENT_ID,
    xClientSecret: raw.X_CLIENT_SECRET ?? null,
    xRedirectUri: raw.X_REDIRECT_URI,
    xScopes: raw.X_SCOPES.split(/[,\s]+/).filter(Boolean),
    xAuthorizeUrl: raw.X_OAUTH_AUTHORIZE_URL,
    xTokenUrl: raw.X_OAUTH_TOKEN_URL,
    xIssuer: raw.X_ISSUER,
    xAudience: raw.X_AUDIENCE,
    xJwksUrl: raw.X_JWKS_URL ?? null,
    xAppBearerToken: raw.X_APP_BEARER_TOKEN ?? null,
    sessionSecret: raw.SESSION_SECRET,
    allowOpaqueXAccessToken: raw.ALLOW_OPAQUE_X_ACCESS_TOKEN ?? false,
    tokenSessionTtlSeconds: raw.TOKEN_SESSION_TTL_SECONDS
  };
}
