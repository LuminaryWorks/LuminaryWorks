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
exports.ChatV2Controller = void 0;
const common_1 = require("@nestjs/common");
const ai_client_1 = require("@luminaryworks/ai-client");
const auth_types_1 = require("../auth/auth.types");
const authz_1 = require("../authz");
const errors_1 = require("../common/errors");
const product_policy_1 = require("../product-policy");
let ChatV2Controller = class ChatV2Controller {
    /**
     * Contract v2 skeleton. Validates the body, then returns 501.
     * Route resolution, the ledger, and upstream tool/multimodal calls are later phases.
     */
    complete(body, req) {
        const principal = req[auth_types_1.AI_PRINCIPAL];
        if (!principal) {
            throw new common_1.UnauthorizedException({
                error: { code: "AUTH_REQUIRED", message: "Authentication required" },
            });
        }
        (0, authz_1.assertHostedCaller)(principal);
        const productCode = productCodeOf(body);
        if (productCode)
            (0, authz_1.assertInferenceProduct)(principal, productCode);
        const loaded = (0, product_policy_1.readProductPolicies)();
        if (!loaded.ok) {
            throw new errors_1.AiPlatformException("VALIDATION_ERROR", 500, loaded.message);
        }
        const result = (0, ai_client_1.validateChatRequestV2)(body, (0, product_policy_1.policyForProduct)(loaded.policies, productCode));
        if (!result.ok) {
            throw new errors_1.AiPlatformException(result.code, 400, result.message);
        }
        throw new errors_1.AiPlatformException("NOT_IMPLEMENTED", 501, "Chat contract v2 is not implemented");
    }
};
exports.ChatV2Controller = ChatV2Controller;
__decorate([
    (0, common_1.Post)("v2/chat/complete"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ChatV2Controller.prototype, "complete", null);
exports.ChatV2Controller = ChatV2Controller = __decorate([
    (0, common_1.Controller)()
], ChatV2Controller);
function productCodeOf(body) {
    if (!body || typeof body !== "object" || !("productCode" in body))
        return "";
    const value = body.productCode;
    return typeof value === "string" ? value.trim() : "";
}
