"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const entities_1 = require("./entities");
const _1762406400000_AiPlatformInitial_1 = require("./migrations/1762406400000-AiPlatformInitial");
const _1762500000000_AiPlatformWallet_1 = require("./migrations/1762500000000-AiPlatformWallet");
const url = process.env.AI_PLATFORM_DATABASE_URL ??
    "postgres://ai_platform:CHANGE_ME@127.0.0.1:5433/ai_platform";
exports.default = new typeorm_1.DataSource({
    type: "postgres",
    url,
    entities: entities_1.ALL_ENTITIES,
    migrations: [_1762406400000_AiPlatformInitial_1.AiPlatformInitial1762406400000, _1762500000000_AiPlatformWallet_1.AiPlatformWallet1762500000000],
    synchronize: false,
});
