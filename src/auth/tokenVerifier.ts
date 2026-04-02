import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import type { TokenSession } from "./tokenStore.js";

type VerifyOptions = {
  requiredScopes: string[];
};

export class OAuthTokenVerifier {
  private readonly jwks;

  constructor(private readonly env: Env) {
    this.jwks = this.env.xJwksUrl ? createRemoteJWKSet(new URL(this.env.xJwksUrl)) : null;
  }

  async verify(session: TokenSession, options: VerifyOptions): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    if (session.expiresAtUnix !== null && session.expiresAtUnix <= now) {
      throw new AppError("AUTH_TOKEN_INVALID", "OAuth access token has expired.", 401, false);
    }

    await this.verifyTokenClaims(session.accessToken);
    ensureScopes(session.scope, options.requiredScopes);
  }

  private async verifyTokenClaims(accessToken: string): Promise<void> {
    if (this.env.xTokenVerificationMode === "dev_skip_verify") {
      return;
    }

    if (this.env.xTokenVerificationMode === "opaque_trust_session") {
      return;
    }

    const isJwt = accessToken.split(".").length === 3;

    if (!isJwt) {
      throw new AppError(
        "AUTH_TOKEN_UNVERIFIABLE",
        "Access token is opaque and cannot be issuer/audience verified in strict_jwt mode.",
        401,
        false,
        {
          hint: "Set X_TOKEN_VERIFICATION_MODE=opaque_trust_session only if your trust boundary accepts session-bound opaque-token verification."
        }
      );
    }

    if (!this.jwks) {
      throw new AppError("AUTH_TOKEN_UNVERIFIABLE", "X_JWKS_URL is required to verify JWT access token signatures.", 500, false);
    }

    try {
      await jwtVerify(accessToken, this.jwks, {
        issuer: this.env.xIssuer,
        audience: this.env.xAudience
      });
    } catch (error) {
      throw new AppError("AUTH_TOKEN_INVALID", "OAuth access token failed issuer/audience/signature verification.", 401, false, {
        reason: error instanceof Error ? error.message : "unknown"
      });
    }
  }
}

function ensureScopes(grantedScopes: string[], requiredScopes: string[]) {
  const missing = requiredScopes.filter((scope) => !grantedScopes.includes(scope));
  if (missing.length > 0) {
    throw new AppError("AUTH_SCOPE_MISSING", "OAuth token is missing required scope(s).", 403, false, {
      missing_scopes: missing
    });
  }
}
