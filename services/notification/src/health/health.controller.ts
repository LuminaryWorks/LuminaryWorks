import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from "@nestjs/terminus";

export const NOTIFICATION_SERVICE_NAME = "luminary-notification";
export const NOTIFICATION_SERVICE_VERSION = "0.1.0";
export const NOTIFICATION_API_VERSION = "v1";
export const NOTIFICATION_SCHEMA_VERSION = "1";

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Get("health")
  liveness() {
    return { status: "ok" };
  }

  @Get("ready")
  @HealthCheck()
  readiness() {
    return this.health.check([() => this.db.pingCheck("database")]);
  }

  @Get("version")
  version() {
    const gitSha = process.env.NOTIFICATION_GIT_SHA?.trim();
    return {
      service: NOTIFICATION_SERVICE_NAME,
      version: NOTIFICATION_SERVICE_VERSION,
      apiVersion: NOTIFICATION_API_VERSION,
      schemaVersion: NOTIFICATION_SCHEMA_VERSION,
      gitSha: gitSha ? gitSha : "unknown",
    };
  }
}
