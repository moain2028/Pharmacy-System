import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { toApiError } from "./errors.js";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger("HTTP");
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();
    const err = toApiError(exception);
    const status = err.getStatus();
    const body = err.getResponse();
    if (status >= 500) this.log.error(`${req.method} ${req.url} -> ${status}`, exception instanceof Error ? exception.stack : String(exception));
    const payload = typeof body === "string" ? { code: "error", message: body } : body;
    void reply.status(status).send({ error: payload, requestId: req.id });
  }
}

export { HttpException };
