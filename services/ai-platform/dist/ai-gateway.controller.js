"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiGatewayController = void 0;
const common_1 = require("@nestjs/common");
const ai_gateway_service_1 = require("./ai-gateway.service");
let AiGatewayController = class AiGatewayController {
    ai;
    constructor(ai) {
        this.ai = ai;
    }
    health() {
        return { ok: true, service: "luminary-ai-platform" };
    }
    providers() {
        return {
            items: this.ai.listConnections(),
            types: ["deepseek", "doubao", "openai", "openai-compatible", "anthropic", "gemini"],
        };
    }
    upsert(body) {
        return this.ai.upsertConnection(body);
    }
    async test(body) {
        const result = await this.ai.complete({
            ephemeral: body.ephemeral,
            messages: [{ role: "user", content: "ping" }],
            maxTokens: 8,
        });
        return { ok: true, model: result.model, providerType: result.providerType };
    }
    complete(body) {
        return this.ai.complete(body);
    }
    async stream(body, reply) {
        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });
        try {
            for await (const ev of this.ai.stream(body)) {
                reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
            }
        }
        catch (err) {
            reply.raw.write(`data: ${JSON.stringify({ type: "error", message: err instanceof Error ? err.message : String(err) })}\n\n`);
        }
        reply.raw.end();
    }
    embed(body) {
        return this.ai.embed(body.texts ?? []);
    }
    transcribe(body) {
        return this.ai.transcribe(body);
    }
    synthesize(body) {
        return this.ai.synthesize(body);
    }
    usage() {
        return { items: this.ai.listUsage() };
    }
};
exports.AiGatewayController = AiGatewayController;
__decorate([
    (0, common_1.Get)("v1/health"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AiGatewayController.prototype, "health", null);
__decorate([
    (0, common_1.Get)("v1/providers"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AiGatewayController.prototype, "providers", null);
__decorate([
    (0, common_1.Post)("v1/providers"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AiGatewayController.prototype, "upsert", null);
__decorate([
    (0, common_1.Post)("v1/providers/test"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AiGatewayController.prototype, "test", null);
__decorate([
    (0, common_1.Post)("v1/chat/complete"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AiGatewayController.prototype, "complete", null);
__decorate([
    (0, common_1.Post)("v1/chat/stream"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AiGatewayController.prototype, "stream", null);
__decorate([
    (0, common_1.Post)("v1/embeddings"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AiGatewayController.prototype, "embed", null);
__decorate([
    (0, common_1.Post)("v1/audio/transcribe"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AiGatewayController.prototype, "transcribe", null);
__decorate([
    (0, common_1.Post)("v1/audio/synthesize"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AiGatewayController.prototype, "synthesize", null);
__decorate([
    (0, common_1.Get)("v1/usage"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AiGatewayController.prototype, "usage", null);
exports.AiGatewayController = AiGatewayController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [ai_gateway_service_1.AiGatewayService])
], AiGatewayController);
