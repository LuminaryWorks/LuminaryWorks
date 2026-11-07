import { AiUsageEventEntity } from "./ai-usage-event.entity";
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
  WalletEntity,
  CreditGrantEntity,
  CreditHoldEntity,
  LedgerEntryEntity,
  RateCardEntity,
  RateCardLineEntity,
];

export { AiUsageEventEntity, ProviderConnectionEntity };
