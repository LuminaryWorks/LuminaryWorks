import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ServiceKeyGuard } from "../auth/service-key.guard";
import { AuthMailService } from "./auth-mail.service";
import { ProfilesService } from "./profiles.service";

@ApiTags("mail")
@ApiBearerAuth()
@UseGuards(ServiceKeyGuard)
@Controller("internal")
export class MailController {
  constructor(
    private readonly authMail: AuthMailService,
    private readonly profiles: ProfilesService,
  ) {}

  @Post("logto/email")
  logtoEmail(@Body() body: unknown) {
    return this.authMail.acceptLogto(body);
  }

  @Get("mail-profiles")
  listProfiles() {
    return this.profiles.list();
  }

  @Post("mail-profiles")
  createProfile(@Body() body: unknown) {
    return this.profiles.create(body);
  }

  @Patch("mail-profiles/:id")
  updateProfile(@Param("id") id: string, @Body() body: unknown) {
    return this.profiles.update(id, body);
  }

  @Delete("mail-profiles/:id")
  deleteProfile(@Param("id") id: string) {
    return this.profiles.remove(id);
  }
}
