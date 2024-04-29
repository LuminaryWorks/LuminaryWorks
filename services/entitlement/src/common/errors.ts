import { HttpException } from "@nestjs/common";
import { type EntitlementErrorCode, ERROR_HTTP_STATUS } from "./constants";

export interface EntitlementErrorBody {
  error: {
    code: EntitlementErrorCode;
    message: string;
    productCode?: string;
    featureCode?: string;
    httpStatus: number;
    details?: Record<string, unknown>;
  };
}

export class EntitlementException extends HttpException {
  readonly code: EntitlementErrorCode;

  constructor(
    code: EntitlementErrorCode,
    message: string,
    opts?: {
      productCode?: string;
      featureCode?: string;
      details?: Record<string, unknown>;
    },
  ) {
    const httpStatus = ERROR_HTTP_STATUS[code];
    const body: EntitlementErrorBody = {
      error: {
        code,
        message,
        productCode: opts?.productCode,
        featureCode: opts?.featureCode,
        httpStatus,
        details: opts?.details,
      },
    };
    super(body, httpStatus);
    this.code = code;
  }
}
