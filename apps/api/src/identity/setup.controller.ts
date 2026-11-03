import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { z } from "zod";
import { CURRENCY_CODES } from "@pharmacore/domain";
import { parse } from "../shared/validation.js";
import { Public } from "./auth.guard.js";
import { SetupService } from "./setup.service.js";

const SetupDto = z.object({
  pharmacy: z.object({
    nameAr: z.string().min(1).max(200),
    nameEn: z.string().min(1).max(200),
    baseCurrency: z.enum(CURRENCY_CODES),
    officialPricePolicy: z.enum(["BLOCK", "BLOCK_WITH_OVERRIDE", "WARN"]).optional(),
    cashRoundStepMinor: z.number().int().min(0).optional(),
  }),
  owner: z.object({
    username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
    displayName: z.string().min(1).max(120),
    password: z.string().min(8).max(256),
    locale: z.enum(["ar", "en"]).optional(),
    pin: z.string().min(4).max(12).regex(/^\d+$/).optional(),
  }),
});

@Controller("setup")
export class SetupController {
  constructor(@Inject(SetupService) private readonly setup: SetupService) {}
  @Public() @Get("status")
  status() { return this.setup.status(); }
  @Public() @Post("initialize")
  initialize(@Body() body: unknown) {
    const dto = parse(SetupDto, body);
    return this.setup.initialize(dto);
  }
}
