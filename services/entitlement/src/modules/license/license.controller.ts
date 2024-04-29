import { Body, Controller, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { REQUEST_ID_KEY } from "../../auth/auth.types";
import { CurrentPrincipal, RequireAdmin } from "../../auth/decorators";
import { ActivateLicenseDto, IssueLicenseDto } from "../partner/partner.dto";
import { LicenseService } from "./license.service";
import type { SignedLicense } from "../../license/ed25519";

@ApiTags("licenses")
@ApiBearerAuth()
@Controller("v1")
export class LicenseController {
  constructor(private readonly licenses: LicenseService) {}

  @RequireAdmin()
  @Post("admin/licenses/issue")
  issue(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: IssueLicenseDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.licenses.issue({
      ...body,
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @RequireAdmin()
  @Post("admin/licenses/activate")
  activate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: ActivateLicenseDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.licenses.activate({
      license: body.license as unknown as SignedLicense,
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  /** Service/admin local verify helper (does not mutate state). */
  @RequireAdmin()
  @Post("licenses/verify")
  verify(@Body() body: ActivateLicenseDto) {
    return this.licenses.verifyLocal(body.license as unknown as SignedLicense);
  }
}
