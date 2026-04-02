import pino from "pino";
import type { Env } from "../config/env.js";

export function buildLogger(env: Env) {
  return pino({
    level: env.logLevel,
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime
  });
}

export type Logger = ReturnType<typeof buildLogger>;
