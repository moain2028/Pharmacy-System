import { describe, expect, it } from "vitest";
import type { Result } from "../shared/result.js";
import {
  argon2idParams,
  checkPasswordAge,
  COMMON_PASSWORDS,
  DEFAULT_PASSWORD_POLICY,
  isCommonPassword,
  lockoutRemainingMs,
  passwordHistoryBlocked,
  validateManagerPin,
  validatePassword,
} from "./password-policy.js";

const codeOf = (r: Result<unknown>): string | undefined => (r.ok ? undefined : r.error.code);
const now = new Date("2025-06-01T00:00:00.000Z");
const daysAgo = (d: number): Date => new Date(now.getTime() - d * 86_400_000);

describe("validatePassword", () => {
  it("golden: 'password123' is rejected as common", () => {
    expect(codeOf(validatePassword({ password: "password123", username: "ahmed" }))).toBe("password.common");
  });

  it("applies checks in order: length, letter, digit, username, common", () => {
    const short = validatePassword({ password: "Ab1", username: "x" });
    expect(codeOf(short)).toBe("password.too_short");
    if (!short.ok) expect(short.error.details).toEqual({ minLength: 10, length: 3 });
    expect(codeOf(validatePassword({ password: "1234567890123", username: "x" }))).toBe("password.missing_letter");
    expect(codeOf(validatePassword({ password: "abcdefghijkl", username: "x" }))).toBe("password.missing_digit");
    expect(codeOf(validatePassword({ password: "Pharmacy2024", username: " pharmacy2024 " }))).toBe("password.equals_username");
    expect(codeOf(validatePassword({ password: "Welcome2024!", username: "x" }))).toBe("password.common");
    expect(validatePassword({ password: "Zahra!Pharm2024", username: "zahra" }).ok).toBe(true);
  });

  it("honours custom policies", () => {
    const relaxedLetter = { ...DEFAULT_PASSWORD_POLICY, requireLetter: false };
    expect(validatePassword({ password: "2947163850", username: "x", policy: relaxedLetter }).ok).toBe(true);
    const relaxedDigit = { ...DEFAULT_PASSWORD_POLICY, requireDigit: false };
    expect(validatePassword({ password: "abcdefghijkl", username: "x", policy: relaxedDigit }).ok).toBe(true);
    const longer = { ...DEFAULT_PASSWORD_POLICY, minLength: 12 };
    expect(codeOf(validatePassword({ password: "Zahra!Pharm", username: "x", policy: longer }))).toBe("password.too_short");
  });

  it("counts code points, not UTF-16 units", () => {
    expect(codeOf(validatePassword({ password: "😀😀😀😀😀", username: "x" }))).toBe("password.too_short");
  });
});

describe("isCommonPassword", () => {
  it("matches case-insensitively and after stripping trailing digits/symbols", () => {
    expect(isCommonPassword("PASSWORD")).toBe(true);
    expect(isCommonPassword(" qwerty!! ")).toBe(true);
    expect(isCommonPassword("admin2024")).toBe(true);
    expect(isCommonPassword("zahra1")).toBe(false);
    expect(isCommonPassword("!!!")).toBe(false);
    expect(isCommonPassword("x")).toBe(false);
    expect(COMMON_PASSWORDS.has("password123")).toBe(true);
    expect(Object.isFrozen(COMMON_PASSWORDS)).toBe(true);
  });
});

describe("checkPasswordAge", () => {
  it("never expires when expiryDays = 0", () => {
    expect(checkPasswordAge(daysAgo(10_000), now).ok).toBe(true);
  });

  it("expires after expiryDays", () => {
    const policy = { ...DEFAULT_PASSWORD_POLICY, expiryDays: 90 };
    expect(checkPasswordAge(daysAgo(10), now, policy).ok).toBe(true);
    expect(checkPasswordAge(daysAgo(90), now, policy).ok).toBe(true);
    const r = checkPasswordAge(daysAgo(91), now, policy);
    expect(codeOf(r)).toBe("password.expired");
    if (!r.ok) expect(r.error.details).toEqual({ expiryDays: 90, ageDays: 91 });
  });
});

describe("passwordHistoryBlocked", () => {
  it("blocks reuse within historyCount only", () => {
    expect(passwordHistoryBlocked([]).ok).toBe(true);
    expect(passwordHistoryBlocked([false, false, false, true]).ok).toBe(true);
    const r = passwordHistoryBlocked([false, false, true]);
    expect(codeOf(r)).toBe("password.reused");
    if (!r.ok) expect(r.error.details).toEqual({ historyCount: 3 });
    expect(passwordHistoryBlocked([false, true], { ...DEFAULT_PASSWORD_POLICY, historyCount: 1 }).ok).toBe(true);
  });
});

describe("lockoutRemainingMs", () => {
  it("locks for 15 minutes after 5 failures", () => {
    expect(lockoutRemainingMs(4, now, now)).toBe(0);
    expect(lockoutRemainingMs(5, now, now)).toBe(15 * 60_000);
    expect(lockoutRemainingMs(7, new Date(now.getTime() - 5 * 60_000), now)).toBe(10 * 60_000);
    expect(lockoutRemainingMs(5, new Date(now.getTime() - 20 * 60_000), now)).toBe(0);
    expect(lockoutRemainingMs(2, now, now, { ...DEFAULT_PASSWORD_POLICY, lockoutAttempts: 2, lockoutMinutes: 1 })).toBe(60_000);
  });
});

describe("validateManagerPin", () => {
  it("accepts 4–6 digits including Arabic-Indic digits", () => {
    expect(validateManagerPin("4821").ok).toBe(true);
    expect(validateManagerPin(" 482913 ").ok).toBe(true);
    expect(validateManagerPin("٤٨٢١").ok).toBe(true);
  });

  it("rejects bad format, weak sequences and password reuse", () => {
    expect(codeOf(validateManagerPin("123"))).toBe("pin.invalid_format");
    expect(codeOf(validateManagerPin("1234567"))).toBe("pin.invalid_format");
    expect(codeOf(validateManagerPin("12a4"))).toBe("pin.invalid_format");
    expect(codeOf(validateManagerPin("1111"))).toBe("pin.too_weak");
    expect(codeOf(validateManagerPin("2345"))).toBe("pin.too_weak");
    expect(codeOf(validateManagerPin("6543"))).toBe("pin.too_weak");
    expect(codeOf(validateManagerPin("4821", { password: "4821" }))).toBe("pin.equals_password");
    expect(codeOf(validateManagerPin("4821", { password: "٤٨٢١" }))).toBe("pin.equals_password");
    expect(validateManagerPin("4821", { password: "Zahra!Pharm2024" }).ok).toBe(true);
  });
});

describe("argon2idParams", () => {
  it("is the frozen 64 MiB / t=3 / p=1 profile", () => {
    expect(argon2idParams).toEqual({ type: "argon2id", memoryCostKiB: 65_536, timeCost: 3, parallelism: 1, hashLength: 32, saltLength: 16 });
    expect(Object.isFrozen(argon2idParams)).toBe(true);
    expect(DEFAULT_PASSWORD_POLICY.minLength).toBe(10);
    expect(Object.isFrozen(DEFAULT_PASSWORD_POLICY)).toBe(true);
  });
});
