import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../identity/auth.service.js";
import { CurrentUser, RequirePermissions } from "../identity/auth.guard.js";
import { parse } from "../shared/validation.js";
import { ImportService } from "./import.service.js";

/** CSV text is sent as JSON `{ csv: "..." }` (≤ 5 MB body) — avoids multipart in the desktop shell and keeps one content type. */
const Body_ = z.object({ csv: z.string().min(1).max(4_000_000) });
const DryRun = z.object({ dryRun: z.enum(["true", "false"]).default("true").transform((v) => v === "true") });
const Kind = z.enum(["customers", "suppliers"]);

@Controller()
export class ImportController {
  constructor(@Inject(ImportService) private readonly svc: ImportService) {}

  @Get("import/templates/:kind") @Header("content-type", "text/csv; charset=utf-8") @RequirePermissions("items.import")
  template(@Param("kind") kind: string) { return this.svc.templates(kind); }

  @Post("import/items") @HttpCode(200) @RequirePermissions("items.import")
  items(@CurrentUser() me: Principal, @Query() q: unknown, @Body() body: unknown) {
    return this.svc.importItems(me.tenantId, me.userId, parse(Body_, body).csv, parse(DryRun, q ?? {}).dryRun);
  }

  @Post("import/:kind") @HttpCode(200) @RequirePermissions("items.import")
  parties(@CurrentUser() me: Principal, @Param("kind") kind: string, @Query() q: unknown, @Body() body: unknown) {
    return this.svc.importParties(me.tenantId, { userId: me.userId, permissions: me.access.permissions }, parse(Kind, kind), parse(Body_, body).csv, parse(DryRun, q ?? {}).dryRun);
  }

  @Get("export/items") @Header("content-type", "text/csv; charset=utf-8") @Header("content-disposition", 'attachment; filename="items.csv"') @RequirePermissions("items.export")
  exportItems(@CurrentUser() me: Principal) { return this.svc.exportItems(me.tenantId); }

  @Get("export/:kind") @Header("content-type", "text/csv; charset=utf-8") @RequirePermissions("items.export")
  exportParties(@CurrentUser() me: Principal, @Param("kind") kind: string) { return this.svc.exportParties(me.tenantId, parse(Kind, kind)); }
}
