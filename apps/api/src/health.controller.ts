import { Controller, Get, Inject } from "@nestjs/common";
import { Db } from "./infra/db.js";
import { Public } from "./identity/auth.guard.js";

@Controller()
export class HealthController {
  constructor(@Inject(Db) private readonly db: Db) {}
  @Public() @Get("health")
  async health() {
    const [r] = await this.db.admin()<{ now: Date; version: string }[]>`SELECT now() AS now, version() AS version`;
    return { status: "ok", time: r!.now, db: r!.version.split(" ").slice(0, 2).join(" ") };
  }
}
