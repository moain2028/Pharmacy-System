import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module.js";
import { CustomersModule } from "../customers/customers.module.js";
import { PurchasingModule } from "../purchasing/purchasing.module.js";
import { ImportController } from "./import.controller.js";
import { ImportService } from "./import.service.js";

@Module({ imports: [CatalogModule, CustomersModule, PurchasingModule], controllers: [ImportController], providers: [ImportService] })
export class ImportModule {}
