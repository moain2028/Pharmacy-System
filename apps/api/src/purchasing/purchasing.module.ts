import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { PurchasingController } from "./purchasing.controller.js";
import { PurchasingService } from "./purchasing.service.js";
import { SuppliersService } from "./suppliers.service.js";

@Module({ imports: [IdentityModule], controllers: [PurchasingController], providers: [PurchasingService, SuppliersService], exports: [PurchasingService, SuppliersService] })
export class PurchasingModule {}
