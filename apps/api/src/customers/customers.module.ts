import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { CustomersController } from "./customers.controller.js";
import { CustomersService } from "./customers.service.js";

@Module({ imports: [IdentityModule], controllers: [CustomersController], providers: [CustomersService], exports: [CustomersService] })
export class CustomersModule {}
