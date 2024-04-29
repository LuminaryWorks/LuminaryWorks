import "reflect-metadata";
import { DataSource } from "typeorm";
import { ALL_ENTITIES } from "./entities";
import { InitialSchema1730000000000 } from "./migrations/1730000000000-InitialSchema";
import { Todo3Extensions1730100000000 } from "./migrations/1730100000000-Todo3Extensions";
import { OutboxLeaseClaim1730200000000 } from "./migrations/1730200000000-OutboxLeaseClaim";
import { ProductTrialPolicy1730300000000 } from "./migrations/1730300000000-ProductTrialPolicy";

const url =
  process.env.ENTITLEMENT_DATABASE_URL ??
  "postgres://entitlement:entitlement_dev@localhost:5434/entitlement";

export default new DataSource({
  type: "postgres",
  url,
  entities: ALL_ENTITIES,
  migrations: [
    InitialSchema1730000000000,
    Todo3Extensions1730100000000,
    OutboxLeaseClaim1730200000000,
    ProductTrialPolicy1730300000000,
  ],
  synchronize: false,
});
