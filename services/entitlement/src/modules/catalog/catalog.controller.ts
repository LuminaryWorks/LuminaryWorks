import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../../auth/decorators";
import { CatalogService } from "./catalog.service";

@ApiTags("catalog")
@Controller("v1/catalog")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get("plans")
  listPlans(@Query("productCode") productCode?: string) {
    return this.catalog.listPlans(productCode);
  }

  @Public()
  @Get("features")
  listFeatures(@Query("productCode") productCode?: string) {
    return this.catalog.listFeatures(productCode);
  }
}
