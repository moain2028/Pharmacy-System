import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { loadConfig, type AppConfig } from "./infra/config.js";
import { DbModule } from "./infra/db.js";
import { IdentityModule } from "./identity/identity.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { SalesModule } from "./sales/sales.module.js";
import { CustomersModule } from "./customers/customers.module.js";
import { PurchasingModule } from "./purchasing/purchasing.module.js";
import { TreasuryModule } from "./treasury/treasury.module.js";
import { ReportsModule } from "./reports/reports.module.js";
import { SystemModule } from "./system/system.module.js";
import { ApiExceptionFilter } from "./shared/http-exception.filter.js";
import { HealthController } from "./health.controller.js";

export function buildAppModule(cfg: AppConfig = loadConfig()) {
  @Module({
    imports: [DbModule.forRoot(cfg), IdentityModule, CatalogModule, InventoryModule, SalesModule, CustomersModule, PurchasingModule, TreasuryModule, ReportsModule, SystemModule],
    controllers: [HealthController],
    providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
  })
  class AppModule {}
  return AppModule;
}
