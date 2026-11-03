import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export interface AccessClaims extends JWTPayload {
  readonly sub: string; // user id
  readonly tid: string; // tenant id
  readonly usr: string; // username
  readonly perms: readonly string[];
  readonly loc: "ar" | "en";
  readonly dev?: string;
}

export class TokenService {
  private readonly key: Uint8Array;
  constructor(secret: string, private readonly accessTtlSec: number) {
    this.key = new TextEncoder().encode(secret);
  }
  async signAccess(claims: Omit<AccessClaims, "iat" | "exp" | "iss">): Promise<string> {
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("pharmacore")
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlSec}s`)
      .sign(this.key);
  }
  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: "pharmacore" });
      if (typeof payload.sub !== "string" || typeof payload["tid"] !== "string") return null;
      return payload as AccessClaims;
    } catch {
      return null;
    }
  }
  /** Opaque refresh token: 32 random bytes, base64url; only its sha256 is stored. */
  static newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: TokenService.hashRefresh(token) };
  }
  static hashRefresh(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
