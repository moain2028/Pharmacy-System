/**
 * Currency registry — D-027.
 * Codes are canonical and exhaustive for v1: YER_OLD, YER_NEW, SAR, USD.
 * `minorUnits` = decimal places stored (amount_minor = amount × 10^minorUnits).
 * Yemeni rial legally has 100 fils but fils are not used in practice; we still store 2 minor
 * digits so prices like 150.5 YER are exact and arithmetic is uniform across currencies.
 */
export const CURRENCY_CODES = ["YER_OLD", "YER_NEW", "SAR", "USD"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export interface CurrencyInfo {
  readonly code: CurrencyCode;
  readonly isoCode: "YER" | "SAR" | "USD";
  readonly minorUnits: 2;
  readonly symbolAr: string;
  readonly symbolEn: string;
  readonly nameAr: string;
  readonly nameEn: string;
}

export const CURRENCIES: Readonly<Record<CurrencyCode, CurrencyInfo>> = Object.freeze({
  YER_OLD: Object.freeze({
    code: "YER_OLD", isoCode: "YER", minorUnits: 2,
    symbolAr: "ر.ي (قديم)", symbolEn: "YER (old)", nameAr: "ريال يمني — طبعة قديمة", nameEn: "Yemeni Rial — old print",
  }),
  YER_NEW: Object.freeze({
    code: "YER_NEW", isoCode: "YER", minorUnits: 2,
    symbolAr: "ر.ي (جديد)", symbolEn: "YER (new)", nameAr: "ريال يمني — طبعة جديدة", nameEn: "Yemeni Rial — new print",
  }),
  SAR: Object.freeze({
    code: "SAR", isoCode: "SAR", minorUnits: 2,
    symbolAr: "ر.س", symbolEn: "SAR", nameAr: "ريال سعودي", nameEn: "Saudi Riyal",
  }),
  USD: Object.freeze({
    code: "USD", isoCode: "USD", minorUnits: 2,
    symbolAr: "$", symbolEn: "USD", nameAr: "دولار أمريكي", nameEn: "US Dollar",
  }),
});

export function isCurrencyCode(x: unknown): x is CurrencyCode {
  return typeof x === "string" && (CURRENCY_CODES as readonly string[]).includes(x);
}

/** 10^minorUnits as bigint (all v1 currencies: 100n). */
export function minorFactor(code: CurrencyCode): bigint {
  return 10n ** BigInt(CURRENCIES[code].minorUnits);
}
