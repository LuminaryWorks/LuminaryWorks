import { Body, Controller, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { REQUEST_ID_KEY } from "../../auth/auth.types";
import { CurrentPrincipal } from "../../auth/decorators";
import {
  resolveTrustedDeploymentId,
  resolveTrustedOrganizationId,
} from "../../auth/principal-context";
import { EnsureTrialDto } from "../../common/dto";
import { EntitlementException } from "../../common/errors";
import { TrialsService } from "./trials.service";

@ApiTags("trials")
@ApiBearerAuth()
@Controller("v1/trials")
export class TrialsController {
  constructor(private readonly trials: TrialsService) {}

  @Post("ensure")
  async ensure(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: EnsureTrialDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    if (principal.kind === "service" && !principal.actAsSubjectId) {
      throw new EntitlementException(
        "FORBIDDEN",
        "Service credential requires X-Act-As-Subject for trial ensure",
      );
    }

    const logtoSub =
      (principal.kind === "service" || principal.kind === "admin") && principal.actAsSubjectId
        ? principal.actAsSubjectId
        : principal.subjectId;

    return this.trials.ensureTrial({
      logtoSub,
      productCode: body.productCode,
      organizationId: resolveTrustedOrganizationId(principal, body.organizationId) ?? undefined,
      deploymentId: resolveTrustedDeploymentId(principal, body.deploymentId),
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }
}
