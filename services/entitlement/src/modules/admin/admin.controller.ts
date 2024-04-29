import { Body, Controller, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { REQUEST_ID_KEY } from "../../auth/auth.types";
import { CurrentPrincipal, RequireAdmin } from "../../auth/decorators";
import { AdminGrantDto } from "../../common/dto";
import { AdminService } from "./admin.service";

@ApiTags("admin")
@ApiBearerAuth()
@RequireAdmin()
@Controller("v1/admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post("grants")
  createGrant(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: AdminGrantDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.admin.createGrant({
      subjectKind: body.subjectKind,
      subjectId: body.subjectId,
      productCode: body.productCode,
      planCode: body.planCode,
      features: body.features,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      seatLimit: body.seatLimit,
      actor: principal.subjectId,
      reason: body.reason,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  @Post("seats")
  upsertSeats(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body()
    body: { organizationId: string; productCode: string; seatLimit: number },
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.admin.upsertSeats({
      organizationId: body.organizationId,
      productCode: body.productCode,
      seatLimit: body.seatLimit,
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
    });
  }

  /** Occupy one seat when a member joins an org product context. */
  @Post("seats/occupy")
  occupySeat(@Body() body: { organizationId: string; productCode: string }) {
    return this.admin.occupySeat(body.organizationId, body.productCode);
  }
}
