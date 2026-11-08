import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import { redactValue } from "../redact";

/**
 * Last-line redaction for anything that escapes a handler: exception messages
 * and JSON bodies lose sk- keys, bearer tokens, and key query parameters.
 */
@Catch()
export class RedactingExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status: (code: number) => { send: (body: unknown) => void };
    }>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response.status(exception.getStatus()).send(typeof body === "string" ? redactValue(body) : redactValue(body));
      return;
    }
    const message = exception instanceof Error ? exception.message : "Provider request failed";
    response.status(500).send({
      error: { code: "PROVIDER_ERROR", message: redactValue(message) },
    });
  }
}
