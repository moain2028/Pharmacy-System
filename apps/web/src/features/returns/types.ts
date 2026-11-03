import type { MoneyJson } from "@/lib/api";

export type QtyMode = "SSU" | "UNIT";
export const REASONS = ["DAMAGED", "WRONG_ITEM", "EXPIRED", "CUSTOMER_CHANGED_MIND", "OTHER"] as const;
export type ReasonCode = (typeof REASONS)[number];
export interface Approver { username: string; secret: string }
export interface ReturnPayload { invoiceId: string; lines: Array<{ lineId: string; qtySsu: string }>; reason: { code: ReasonCode; text?: string }; refundToCustomerCredit: boolean; approver?: Approver }
export interface ReturnQuote { id?: string; number?: string; refundTotal: MoneyJson; refunds: Array<{ method: string; amount: MoneyJson }>; lots: Array<{ lotId: string; lotNumber?: string; qtySsu: string; destination: string }> }
export interface PrevReturn { lines?: Array<{ lineId?: string; line_id?: string; qtySsu?: string; qty_ssu?: string }> }
