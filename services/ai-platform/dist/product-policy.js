"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readProductPolicies = readProductPolicies;
exports.policyForProduct = policyForProduct;
function readProductPolicies(raw = process.env.AI_PRODUCT_POLICIES_JSON) {
    if (!raw?.trim())
        return { ok: true, policies: [] };
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return { ok: false, message: "AI_PRODUCT_POLICIES_JSON must be an array" };
        }
        return { ok: true, policies: parsed };
    }
    catch {
        return { ok: false, message: "AI_PRODUCT_POLICIES_JSON is not valid JSON" };
    }
}
function policyForProduct(policies, productCode) {
    return policies.find((policy) => policy.productCode === productCode);
}
