import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
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
  if (cfg.NODE_ENV !== "production" || cfg.ENABLE_DOCS) {
    // OpenAPI: route inventory + auth scheme. Zod schemas are the request truth; bodies are documented per controller.
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder()
      .setTitle("PharmaCore API").setVersion("1").setDescription("Pharmacy management API — Arabic/English error envelope `{ error: { code, message, messageEn, details? }, requestId }`. Money = minor-unit strings; quantities in SSU.")
      .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }).addServer("/").build());
    SwaggerModule.setup("api/docs", app, doc, { jsonDocumentUrl: "api/docs.json", swaggerOptions: { persistAuthorization: true } });
  }
  if (cfg.STATIC_DIR && existsSync(cfg.STATIC_DIR)) {
    // Desktop/single-process mode: serve the SPA; unknown non-API paths fall back to index.html.
    const root = resolve(cfg.STATIC_DIR);
    const fastifyStatic = (await import("@fastify/static")).default;
    await adapter.getInstance().register(fastifyStatic, { root, prefix: "/", wildcard: false, decorateReply: true, cacheControl: true, maxAge: "1h", immutable: false });
    adapter.getInstance().setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.status(404).send({ error: { code: "http.not_found", message: "Not found", messageEn: "Not found" }, requestId: req.id });
      return reply.header("Cache-Control", "no-store").sendFile("index.html", join(root));
    });
  }
  app.enableShutdownHooks();
  return app;
}
