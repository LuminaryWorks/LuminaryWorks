import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from "@nestjs/terminus";
import { Public } from "../auth/decorators";
import { ConnectionsHealthIndicator, VaultHealthIndicator } from "./health.indicators";

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly vault: VaultHealthIndicator,
    private readonly connections: ConnectionsHealthIndicator,
  ) {}

  /** Liveness only. Does not probe Postgres or the vault. */
  @Public()
  @Get("v1/health")
  liveness() {
    return { ok: true, service: "luminary-ai-platform" };
  }

  /**
   * Critical dependencies: Postgres and the vault master key.
   * Enabled connection count is reported and does not fail readiness.
   */
  @Public()
  @Get("ready")
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.db.pingCheck("database"),
      () => this.vault.isHealthy("vault"),
      () => this.connections.isHealthy("connections"),
    ]);
  }
}
