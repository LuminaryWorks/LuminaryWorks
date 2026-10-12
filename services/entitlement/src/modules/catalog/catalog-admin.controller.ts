import { Body, Controller, Get, Param, Post, Put, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthPrincipal } from "../../auth/auth.types";
import { REQUEST_ID_KEY } from "../../auth/auth.types";
import { catalogScopeFromScopes } from "../../common/catalog-scope";
import { CurrentPrincipal, RequireCatalogAccess } from "../../auth/decorators";
import { CatalogRevisionDraftDto, ReplaceCatalogOfferingsDto } from "../../common/dto";
import { CatalogAdminService } from "./catalog-admin.service";

@ApiTags("admin-catalog")
@ApiBearerAuth()
@RequireCatalogAccess()
@Controller("v1/admin/catalog")
export class CatalogAdminController {
  constructor(private readonly catalogAdmin: CatalogAdminService) {}

  @Get("revisions")
  listRevisions() {
    return this.catalogAdmin.listRevisions();
  }

  @Get("revisions/:id")
  getRevision(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string) {
    return this.catalogAdmin.getRevision(id, catalogScopeFromScopes(principal));
  }

  @Post("revisions")
  createDraft(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CatalogRevisionDraftDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.catalogAdmin.createDraft({
      notes: body.notes,
      copyFromPublished: body.copyFromPublished,
      offerings: body.offerings,
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
      scope: catalogScopeFromScopes(principal),
    });
  }

  @Put("revisions/:id/offerings")
  replaceOfferings(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Body() body: ReplaceCatalogOfferingsDto,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.catalogAdmin.replaceDraftOfferings(id, body.offerings, {
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
      scope: catalogScopeFromScopes(principal),
    });
  }

  @Post("revisions/:id/publish")
  publish(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.catalogAdmin.publish(id, {
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
      scope: catalogScopeFromScopes(principal),
    });
  }

  @Post("revisions/:id/rollback")
  rollback(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id") id: string,
    @Req() req: { [REQUEST_ID_KEY]?: string },
  ) {
    return this.catalogAdmin.rollback(id, {
      actor: principal.subjectId,
      requestId: req[REQUEST_ID_KEY],
      scope: catalogScopeFromScopes(principal),
    });
  }
}
