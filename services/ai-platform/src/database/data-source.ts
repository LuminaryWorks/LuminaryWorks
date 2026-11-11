import "reflect-metadata";
import { DataSource } from "typeorm";
import { ALL_ENTITIES } from "./entities";
import { AiPlatformConnectionAudit1762600000000 } from "./migrations/1762600000000-AiPlatformConnectionAudit";
import { AiPlatformConnectionProductCode1762800000000 } from "./migrations/1762800000000-AiPlatformConnectionProductCode";
import { AiPlatformInitial1762406400000 } from "./migrations/1762406400000-AiPlatformInitial";
import { AiPlatformWallet1762500000000 } from "./migrations/1762500000000-AiPlatformWallet";

const url =
  process.env.AI_PLATFORM_DATABASE_URL ??
  "postgres://ai_platform:CHANGE_ME@127.0.0.1:5433/ai_platform";

export default new DataSource({
  type: "postgres",
  url,
  entities: ALL_ENTITIES,
  migrations: [
    AiPlatformInitial1762406400000,
    AiPlatformWallet1762500000000,
    AiPlatformConnectionAudit1762600000000,
    AiPlatformConnectionProductCode1762800000000,
  ],
  synchronize: false,
});
