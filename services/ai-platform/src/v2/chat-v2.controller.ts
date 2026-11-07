import { Body, Controller, Post, Req, UnauthorizedException } from "@nestjs/common";
import { validateChatRequestV2 } from "@luminaryworks/ai-client";
import { AI_PRINCIPAL, type AuthedRequest } from "../auth/auth.types";
import { assertHostedCaller, assertInferenceProduct } from "../authz";
import { AiPlatformException } from "../common/errors";
import { policyForProduct, readProductPolicies } from "../product-policy";

@Controller()
export class ChatV2Controller {
  /**
   * Contract v2 skeleton. Validates the body, then returns 501.
   * Route resolution, the ledger, and upstream tool/multimodal calls are later phases.
   */
  @Post("v2/chat/complete")
  complete(@Body() body: unknown, @Req() req: AuthedRequest) {
    const principal = req[AI_PRINCIPAL];
    if (!principal) {
      throw new UnauthorizedException({
        error: { code: "AUTH_REQUIRED", message: "Authentication required" },
      });
    }
    assertHostedCaller(principal);
    const productCode = productCodeOf(body);
    if (productCode) assertInferenceProduct(principal, productCode);
    const loaded = readProductPolicies();
    if (!loaded.ok) {
      throw new AiPlatformException("VALIDATION_ERROR", 500, loaded.message);
    }
    const result = validateChatRequestV2(body, policyForProduct(loaded.policies, productCode));
    if (!result.ok) {
      throw new AiPlatformException(result.code, 400, result.message);
    }
    throw new AiPlatformException("NOT_IMPLEMENTED", 501, "Chat contract v2 is not implemented");
  }
}

function productCodeOf(body: unknown): string {
  if (!body || typeof body !== "object" || !("productCode" in body)) return "";
  const value = (body as { productCode?: unknown }).productCode;
  return typeof value === "string" ? value.trim() : "";
}
