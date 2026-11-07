"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const platform_fastify_1 = require("@nestjs/platform-fastify");
const app_module_1 = require("./app.module");
const ai_platform_config_1 = require("./config/ai-platform.config");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, new platform_fastify_1.FastifyAdapter({ logger: false }));
    const settings = app.get(config_1.ConfigService).getOrThrow("aiPlatform");
    (0, ai_platform_config_1.assertAiPlatformAuthConfig)(settings);
    await app.listen(settings.port, "0.0.0.0");
    console.log(`LuminaryWorks AI Platform http://localhost:${settings.port}/v1/health`);
}
bootstrap();
