import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { SalesController } from "./sales.controller.js";
import { SalesService } from "./sales.service.js";
import { ReturnsController } from "./returns.controller.js";
import { ReturnsService } from "./returns.service.js";
import { ShiftsService } from "./shifts.service.js";

@Module({ imports: [IdentityModule], controllers: [SalesController, ReturnsController], providers: [SalesService, ShiftsService, ReturnsService], exports: [SalesService, ShiftsService, ReturnsService] })
export class SalesModule {}
