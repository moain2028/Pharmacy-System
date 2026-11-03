/**
 * Password & manager-PIN policy — FR-IAM-105/107. Pure validators only; hashing/verification live in
 * infrastructure using `argon2idParams`. Defaults are stricter than the spec floor (min length 10).
 */
import { normalizeDigits } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";

/** Argon2id parameters for passwords AND manager PINs (m = 64 MiB, t = 3, p = 1). */
export const argon2idParams = Object.freeze({
  type: "argon2id",
  memoryCostKiB: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
  saltLength: 16,
} as const);

export interface PasswordPolicy {
  readonly minLength: number;
  readonly requireDigit: boolean;
  readonly requireLetter: boolean;
  /** Max password age in days; 0 = never expires. */
  readonly expiryDays: number;
  /** Number of previous passwords that may not be reused. */
  readonly historyCount: number;
  readonly lockoutAttempts: number;
  readonly lockoutMinutes: number;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = Object.freeze({
  minLength: 10,
  requireDigit: true,
  requireLetter: true,
  expiryDays: 0,
  historyCount: 3,
  lockoutAttempts: 5,
  lockoutMinutes: 15,
});

/** Small embedded deny-list (lower-case). Trailing digits/symbols are stripped before matching. */
export const COMMON_PASSWORDS: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    "password", "password1", "password123", "passw0rd", "p@ssw0rd", "123456", "1234567", "12345678",
    "123456789", "1234567890", "111111", "000000", "11111111", "00000000", "12341234", "0123456789",
    "9876543210", "147258369", "qwerty", "qwerty123", "qwertyuiop", "1q2w3e4r", "1qaz2wsx", "zaq12wsx",
    "asdfgh", "zxcvbn", "abc123", "admin", "admin123", "administrator", "letmein", "welcome", "welcome1",
    "iloveyou", "monkey", "dragon", "sunshine", "princess", "football", "baseball", "changeme", "secret",
    "test", "test123", "user", "guest", "root", "pharmacy", "pharmacore", "pharmacist", "cashier", "manager",
    "yemen", "sanaa", "aden", "taiz",
  ]),
);

export function isCommonPassword(password: string): boolean {
  const lower = password.trim().toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return true;
  const stripped = lower.replace(/[\d!@#$%^&*._-]+$/, "");
  return stripped !== lower && stripped.length > 0 && COMMON_PASSWORDS.has(stripped);
}

export interface PasswordCheckInput {
  readonly password: string;
  readonly username: string;
  readonly policy?: PasswordPolicy;
}

export function validatePassword(input: PasswordCheckInput): Result<void> {
  const policy = input.policy ?? DEFAULT_PASSWORD_POLICY;
  const pw = input.password;
  const length = [...pw].length;
  if (length < policy.minLength) {
    return domainErr("password.too_short", `Password must have at least ${policy.minLength} characters`, {
      minLength: policy.minLength,
      length,
    });
  }
  if (policy.requireLetter && !/\p{L}/u.test(pw)) {
    return domainErr("password.missing_letter", "Password must contain a letter");
  }
  if (policy.requireDigit && !/\p{Nd}/u.test(pw)) {
    return domainErr("password.missing_digit", "Password must contain a digit");
  }
  if (pw.trim().toLowerCase() === input.username.trim().toLowerCase()) {
    return domainErr("password.equals_username", "Password must not equal the username");
  }
  if (isCommonPassword(pw)) {
    return domainErr("password.common", "Password is too common");
  }
  return ok(undefined);
}

/** FR-IAM-107 `expiry_days`: fails when the password is older than the policy allows. */
export function checkPasswordAge(changedAt: Date, now: Date, policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY): Result<void> {
  if (policy.expiryDays <= 0) return ok(undefined);
  const ageMs = now.getTime() - changedAt.getTime();
  const maxMs = policy.expiryDays * 86_400_000;
  if (ageMs > maxMs) {
    return domainErr("password.expired", "Password has expired and must be changed", {
      expiryDays: policy.expiryDays,
      ageDays: Math.floor(ageMs / 86_400_000),
    });
  }
  return ok(undefined);
}

/**
 * FR-IAM-107 `history_count`: infrastructure verifies the candidate against the stored hashes
 * (newest first) and passes the match flags here; only the first `historyCount` entries count.
 */
export function passwordHistoryBlocked(
  matchesNewestFirst: readonly boolean[],
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): Result<void> {
  if (matchesNewestFirst.slice(0, policy.historyCount).some((m) => m)) {
    return domainErr("password.reused", `Password must differ from the last ${policy.historyCount} passwords`, {
      historyCount: policy.historyCount,
    });
  }
  return ok(undefined);
}

/** Milliseconds the account/PIN stays locked (0 = not locked). Same rule for passwords and PINs. */
export function lockoutRemainingMs(
  failedAttempts: number,
  lastFailedAt: Date,
  now: Date,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): number {
  if (failedAttempts < policy.lockoutAttempts) return 0;
  const until = lastFailedAt.getTime() + policy.lockoutMinutes * 60_000;
  return Math.max(0, until - now.getTime());
}

/**
 * FR-IAM-105: manager PIN is 4–6 digits (Arabic-Indic digits accepted), not trivially weak and
 * never equal to the password ("small things" #11).
 */
export function validateManagerPin(pin: string, opts: { readonly password?: string } = {}): Result<void> {
  const digits = normalizeDigits(pin.trim());
  if (!/^\d{4,6}$/.test(digits)) {
    return domainErr("pin.invalid_format", "Manager PIN must be 4 to 6 digits");
  }
  if (/^(\d)\1+$/.test(digits) || "0123456789".includes(digits) || "9876543210".includes(digits)) {
    return domainErr("pin.too_weak", "Manager PIN must not be repeated or sequential digits");
  }
  if (opts.password !== undefined && normalizeDigits(opts.password.trim()) === digits) {
    return domainErr("pin.equals_password", "Manager PIN must differ from the password");
  }
  return ok(undefined);
}
