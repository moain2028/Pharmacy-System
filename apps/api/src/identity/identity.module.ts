import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { SetupController } from "./setup.controller.js";
import { DemoSeedService } from "./demo-seed.service.js";
import { SetupService } from "./setup.service.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({
  controllers: [AuthController, SetupController, UsersController],
  providers: [AuthService, SetupService, UsersService, DemoSeedService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class IdentityModule {}
