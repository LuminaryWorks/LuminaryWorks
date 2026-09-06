import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from "@nestjs/terminus";
import { Public } from "../../auth/decorators";
import { buildServiceVersionPayload } from "../../common/service-version";

/**
 * health / ready / version contract shared by every LuminaryWorks central
 * service (see spec/composable-deployment.md):
 *
 *   GET /health   liveness only — the process is up.
 *   GET /ready    non-2xx while a critical dependency is unusable.
 *   GET /version  service, API and payload schema versions plus the git SHA.
 */
@ApiTags("health")
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Public()
  @Get("health")
  liveness() {
    return { status: "ok" };
  }

  @Public()
  @Get("ready")
  @HealthCheck()
  readiness() {
    return this.health.check([() => this.db.pingCheck("database")]);
  }

  @Public()
  @Get("version")
  version() {
    return buildServiceVersionPayload();
  }
}
