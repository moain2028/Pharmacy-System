import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3100),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url(),
  /** HS256 secret for access tokens (>= 32 chars). Desktop installer generates one per machine. */
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(15 * 60),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(14 * 24 * 3600),
  AUTO_MIGRATE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}

export const CONFIG = Symbol("CONFIG");
