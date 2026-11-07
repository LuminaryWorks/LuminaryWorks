import { HttpException } from "@nestjs/common";

export class AiPlatformException extends HttpException {
  readonly code: string;

  constructor(code: string, status: number, message: string) {
    super({ error: { code, message } }, status);
    this.code = code;
  }
}
