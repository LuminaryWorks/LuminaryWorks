import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ProviderConnectionEntity } from "../database/entities";
import { vaultKeyUsable } from "../policy";

@Injectable()
export class VaultHealthIndicator {
  constructor(private readonly healthIndicatorService: HealthIndicatorService) {}

  isHealthy(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    if (!vaultKeyUsable(process.env.AI_VAULT_MASTER_KEY)) {
      return indicator.down("AI_VAULT_MASTER_KEY missing");
    }
    return indicator.up();
  }
}

@Injectable()
export class ConnectionsHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @InjectRepository(ProviderConnectionEntity)
    private readonly connections: Repository<ProviderConnectionEntity>,
  ) {}

  async isHealthy(key: string) {
    const enabled = await this.connections.count({ where: { enabled: true } });
    return this.healthIndicatorService.check(key).up({ enabled });
  }
}
