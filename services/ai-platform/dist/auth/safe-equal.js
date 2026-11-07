"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeEqualString = safeEqualString;
const node_crypto_1 = require("node:crypto");
/** Constant-time string comparison (UTF-8). */
function safeEqualString(a, b) {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    if (left.length !== right.length) {
        (0, node_crypto_1.timingSafeEqual)(left, left);
        return false;
    }
    return (0, node_crypto_1.timingSafeEqual)(left, right);
}
