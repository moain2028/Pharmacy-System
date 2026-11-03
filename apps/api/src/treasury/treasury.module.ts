import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { TreasuryController } from "./treasury.controller.js";
import { TreasuryService } from "./treasury.service.js";

@Module({ imports: [IdentityModule], controllers: [TreasuryController], providers: [TreasuryService], exports: [TreasuryService] })
export class TreasuryModule {}
