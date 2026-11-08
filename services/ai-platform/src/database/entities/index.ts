import { AiUsageEventEntity } from "./ai-usage-event.entity";
import { ConnectionAuditEventEntity } from "./connection-audit-event.entity";
import { ProviderConnectionEntity } from "./provider-connection.entity";
import {
  CreditGrantEntity,
  CreditHoldEntity,
  LedgerEntryEntity,
  RateCardEntity,
  RateCardLineEntity,
  WalletEntity,
} from "./wallet.entities";

export const ALL_ENTITIES = [
  ProviderConnectionEntity,
  AiUsageEventEntity,
  ConnectionAuditEventEntity,
  WalletEntity,
  CreditGrantEntity,
  CreditHoldEntity,
  LedgerEntryEntity,
  RateCardEntity,
  RateCardLineEntity,
];

export { AiUsageEventEntity, ConnectionAuditEventEntity, ProviderConnectionEntity };
