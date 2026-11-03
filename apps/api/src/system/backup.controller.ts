import { Body, Controller, Get, HttpCode, Inject, Param, Post, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { createReadStream } from "node:fs";
import { z } from "zod";
import { RequirePermissions } from "../identity/auth.guard.js";
import { parse } from "../shared/validation.js";
import { BackupService } from "./backup.service.js";

const Create = z.object({ note: z.string().max(200).optional() });
const Confirm = z.object({ confirm: z.literal("RESTORE") });

@Controller("backup")
export class BackupController {
  constructor(@Inject(BackupService) private readonly svc: BackupService) {}

  @Get() @RequirePermissions("settings.backup")
  list() { return this.svc.list(); }

  @Post() @RequirePermissions("settings.backup")
  create(@Body() body: unknown) { return this.svc.create(parse(Create, body ?? {}).note); }

  @Get(":name/verify") @RequirePermissions("settings.backup")
  verify(@Param("name") name: string) { return this.svc.verify(name); }

  @Get(":name/download") @RequirePermissions("settings.backup")
  async download(@Param("name") name: string, @Res() reply: FastifyReply) {
    const path = await this.svc.filePath(name);
    reply.header("content-type", "application/octet-stream").header("content-disposition", `attachment; filename="${name}"`);
    return reply.send(createReadStream(path));
  }

  /** Owner-only destructive restore; body must be { confirm: "RESTORE" }. */
  @Post(":name/restore") @HttpCode(200) @RequirePermissions("settings.backup", "settings.update")
  restore(@Param("name") name: string, @Body() body: unknown) { parse(Confirm, body); return this.svc.restore(name); }
}
