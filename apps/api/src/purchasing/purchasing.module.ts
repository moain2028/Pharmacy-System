import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { PurchasingController } from "./purchasing.controller.js";
import { PurchasingService } from "./purchasing.service.js";
import { SuppliersService } from "./suppliers.service.js";
import { PayablesController } from "./payables.controller.js";
import { PayablesService } from "./payables.service.js";

@Module({ imports: [IdentityModule], controllers: [PurchasingController, PayablesController], providers: [PurchasingService, SuppliersService, PayablesService], exports: [PurchasingService, SuppliersService, PayablesService] })
export class PurchasingModule {}
