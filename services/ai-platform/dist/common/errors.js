"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiPlatformException = void 0;
const common_1 = require("@nestjs/common");
class AiPlatformException extends common_1.HttpException {
    code;
    constructor(code, status, message) {
        super({ error: { code, message } }, status);
        this.code = code;
    }
}
exports.AiPlatformException = AiPlatformException;
