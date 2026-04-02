export type RateLimitInfo = {
  limit: number | null;
  remaining: number | null;
  resetUnix: number | null;
};

export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const limit = parseNumberHeader(headers.get("x-rate-limit-limit"));
  const remaining = parseNumberHeader(headers.get("x-rate-limit-remaining"));
  const resetUnix = parseNumberHeader(headers.get("x-rate-limit-reset"));
  return { limit, remaining, resetUnix };
}

export function hasRateLimitInfo(rateLimit: RateLimitInfo): boolean {
  return rateLimit.limit !== null || rateLimit.remaining !== null || rateLimit.resetUnix !== null;
}

function parseNumberHeader(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
