import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
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
  app.enableShutdownHooks();
  return app;
}
