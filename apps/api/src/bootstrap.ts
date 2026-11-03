import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { buildAppModule } from "./app.module.js";
import type { AppConfig } from "./infra/config.js";

export async function createApp(cfg: AppConfig): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({ logger: false, bodyLimit: 5 * 1024 * 1024 });
  const app = await NestFactory.create<NestFastifyApplication>(buildAppModule(cfg), adapter, {
    logger: cfg.NODE_ENV === "test" ? ["error"] : ["log", "warn", "error"],
  });
  // Baseline security headers (API-only; no inline HTML served here)
  adapter.getInstance().addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
  });
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();
  return app;
}
