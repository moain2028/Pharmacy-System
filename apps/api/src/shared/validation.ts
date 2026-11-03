import { type ZodSchema, type ZodTypeDef } from "zod";
import { ApiError } from "./errors.js";

/** Parses a request body/query with zod; throws 400 with field-level details. */
export function parse<T, I = unknown>(schema: ZodSchema<T, ZodTypeDef, I>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw ApiError.badRequest("validation.failed", "Request validation failed", {
      issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code })),
    });
  }
  return r.data;
}

export const uuid = () => import("zod").then((z) => z.z.string().uuid());
