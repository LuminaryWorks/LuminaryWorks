import { Body, Controller, Get, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { CurrentPrincipal, RequireAdmin } from "../../auth/decorators";
import { UpsertNotificationPreferenceDto } from "../partner/partner.dto";
import { InAppNotifyAdapter } from "./in-app.adapter";
import { NotificationPreferenceService } from "./notification-preference.service";
import { OutboxService } from "./outbox.service";

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("v1")
export class NotifyController {
  constructor(
    private readonly prefs: NotificationPreferenceService,
    private readonly outbox: OutboxService,
    private readonly inApp: InAppNotifyAdapter,
  ) {}

  @Get("notifications/preferences")
  async getPrefs(@CurrentPrincipal() principal: AuthPrincipal) {
    const sub =
      principal.kind === "user"
        ? principal.subjectId
        : (principal.actAsSubjectId ?? principal.subjectId);
    return this.prefs.getOrDefault(sub);
  }

  @Put("notifications/preferences")
  async putPrefs(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: UpsertNotificationPreferenceDto,
  ) {
    const sub =
      principal.kind === "user"
        ? principal.subjectId
        : (principal.actAsSubjectId ?? principal.subjectId);
    return this.prefs.upsert(sub, body);
  }

  /** Recent in-app messages for the subject (dev / product polling). */
  @Get("notifications/in-app")
  listInApp(@CurrentPrincipal() principal: AuthPrincipal) {
    const sub =
      principal.kind === "user"
        ? principal.subjectId
        : (principal.actAsSubjectId ?? principal.subjectId);
    return this.inApp.messages.filter((m) => m.logtoSub === sub).slice(-50);
  }

  @RequireAdmin()
  @Post("admin/outbox/poll")
  pollOutbox() {
    return this.outbox.poll().then((n) => ({ processed: n }));
  }
}
