import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from "@nestjs/terminus";
import { Public } from "../../auth/decorators";

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
}
