"use strict";
/** Integer micro-units. 1 credit = 1_000_000 micro. Never use floats. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ceilDiv = ceilDiv;
exports.microToNumber = microToNumber;
exports.assertPositiveMicro = assertPositiveMicro;
exports.isUniqueViolation = isUniqueViolation;
function ceilDiv(numerator, denominator) {
    if (denominator <= 0n)
        throw new Error("denominator must be positive");
    if (numerator <= 0n)
        return 0n;
    return (numerator + denominator - 1n) / denominator;
}
function microToNumber(value) {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    if (value > max || value < -max) {
        throw new Error("micro amount exceeds Number.MAX_SAFE_INTEGER");
    }
    return Number(value);
}
function assertPositiveMicro(value, label) {
    if (value <= 0n)
        throw new Error(`${label} must be positive`);
}
function isUniqueViolation(error) {
    if (typeof error !== "object" || error === null)
        return false;
    const row = error;
    return row.code === "23505" || row.driverError?.code === "23505";
}
