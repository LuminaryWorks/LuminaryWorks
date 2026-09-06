import { Body, Controller, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { REQUEST_ID_KEY } from "../../auth/auth.types";
import { CurrentPrincipal } from "../../auth/decorators";
import { EnsurePromotionDto } from "../../common/dto";
import { EntitlementException } from "../../common/errors";
import { PromotionsService } from "./promotions.service";

@ApiTags("promotions")
@ApiBearerAuth()
@Controller("v1/promotions")
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Post("ensure")
  async ensure(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: EnsurePromotionDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    if (principal.kind === "service" && !principal.actAsSubjectId) {
      throw new EntitlementException(
        "FORBIDDEN",
        "Service credential requires X-Act-As-Subject for promotion ensure",
      );
    }
    const subjectId =
      (principal.kind === "service" || principal.kind === "admin") && principal.actAsSubjectId
        ? principal.actAsSubjectId
        : principal.subjectId;
    return this.promotions.ensureOnceGrant({
      subjectId,
      productCode: body.productCode,
      promotionCode: body.promotionCode,
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }
}
