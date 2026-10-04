"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const platform_fastify_1 = require("@nestjs/platform-fastify");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, new platform_fastify_1.FastifyAdapter({ logger: false }));
    const port = Number(process.env.PORT ?? 13100);
    await app.listen(port, "0.0.0.0");
    console.log(`LuminaryWorks AI Platform http://localhost:${port}/v1/health`);
}
bootstrap();
