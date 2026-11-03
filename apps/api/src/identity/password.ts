import argon2 from "argon2";

/** OWASP 2023 Argon2id baseline: m=19 MiB, t=2, p=1. */
const OPTS: argon2.Options = { type: argon2.argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTS);
}
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, OPTS);
}
