import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { SalesController } from "./sales.controller.js";
import { SalesService } from "./sales.service.js";
import { ShiftsService } from "./shifts.service.js";

@Module({ imports: [IdentityModule], controllers: [SalesController], providers: [SalesService, ShiftsService], exports: [SalesService, ShiftsService] })
export class SalesModule {}
