import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthedRequest } from "../identity/auth.guard.js";
import { toApiError } from "./errors.js";
import { localize, pickLocale } from "./i18n.js";

interface ErrBody { code?: string; message?: string; details?: Record<string, unknown> }

/**
 * Single error envelope: `{ error: { code, message (localised), messageEn, details? }, requestId }`.
 * Locale: principal.locale → Accept-Language → ar.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger("HTTP");
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<AuthedRequest>();
    const err = toApiError(exception);
    const status = err.getStatus();
    const raw = err.getResponse();
    if (status >= 500) this.log.error(`${req.method} ${req.url} -> ${status}`, exception instanceof Error ? exception.stack : String(exception));
    const body: ErrBody = typeof raw === "string" ? { code: "error", message: raw } : (raw as ErrBody);
    const code = body.code ?? "error";
    const messageEn = body.message ?? code;
    const locale = pickLocale(req.principal?.locale, (req as FastifyRequest).headers["accept-language"]);
    const payload: Record<string, unknown> = { code, message: localize(code, locale, messageEn), messageEn };
    if (body.details) payload["details"] = body.details;
    void reply.status(status).send({ error: payload, requestId: req.id });
  }
}

export { HttpException };
