import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { loadConfig, type AppConfig } from "./infra/config.js";
import { DbModule } from "./infra/db.js";
import { IdentityModule } from "./identity/identity.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { ApiExceptionFilter } from "./shared/http-exception.filter.js";
import { HealthController } from "./health.controller.js";

export function buildAppModule(cfg: AppConfig = loadConfig()) {
  @Module({
    imports: [DbModule.forRoot(cfg), IdentityModule, CatalogModule],
    controllers: [HealthController],
    providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
  })
  class AppModule {}
  return AppModule;
}
