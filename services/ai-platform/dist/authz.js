"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bindCaller = bindCaller;
exports.canManageConnection = canManageConnection;
exports.canUseConnection = canUseConnection;
exports.assertCanManageConnection = assertCanManageConnection;
exports.assertCanUseConnection = assertCanUseConnection;
exports.assertHostedCaller = assertHostedCaller;
exports.assertInferenceProduct = assertInferenceProduct;
exports.assertInternalService = assertInternalService;
const errors_1 = require("./common/errors");
/**
 * User tokens cannot choose whose quota or usage a call belongs to.
 * Service credentials are the product BFF: they must name the end user, and
 * that name is trusted (see the service-path note in the call-site comments).
 */
function bindCaller(principal, body) {
    if (principal.kind === "user") {
        if (body.subjectId !== undefined && normalize(body.subjectId) !== principal.subjectId) {
            throw new errors_1.AiPlatformException("ENTITLEMENT_DENIED", 403, "subjectId does not match the authenticated user");
        }
        if (body.organizationId !== undefined &&
            normalize(body.organizationId) !== normalize(principal.organizationId)) {
            throw new errors_1.AiPlatformException("ENTITLEMENT_DENIED", 403, "organizationId does not match the authenticated user");
        }
        return { subjectId: principal.subjectId, organizationId: normalize(principal.organizationId) };
    }
    const subjectId = normalize(body.subjectId);
    if (!subjectId) {
        throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "subjectId is required");
    }
    if (body.organizationId === undefined) {
        throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "organizationId is required");
    }
    return { subjectId, organizationId: normalize(body.organizationId) };
}
/** Cross-tenant and deployment administration is service-only. */
function canManageConnection(principal, owner) {
    if (principal.kind === "service")
        return true;
    if (owner.ownerKind === "user")
        return owner.ownerUid === principal.subjectId;
    if (owner.ownerKind === "organization") {
        return Boolean(principal.organizationId) && owner.ownerUid === principal.organizationId;
    }
    return false;
}
/**
 * A user may invoke only their own user connection or their organization's.
 * A service credential may invoke any saved connection. The platform does not
 * re-check that the subjectId named by the BFF owns that connection.
 */
function canUseConnection(principal, owner) {
    if (principal.kind === "service")
        return true;
    return canManageConnection(principal, owner);
}
function assertCanManageConnection(principal, owner) {
    if (!canManageConnection(principal, owner)) {
        throw new errors_1.AiPlatformException("FORBIDDEN", 403, "connection is outside the caller scope");
    }
}
function assertCanUseConnection(principal, owner) {
    if (!canUseConnection(principal, owner)) {
        throw new errors_1.AiPlatformException("FORBIDDEN", 403, "connection is outside the caller scope");
    }
}
/** Hosted inference is a product BFF path. User JWTs cannot call it. */
function assertHostedCaller(principal) {
    if (principal.kind !== "service") {
        throw new errors_1.AiPlatformException("FORBIDDEN", 403, "hosted inference requires a product service credential");
    }
}
/**
 * Service credentials may only assert a productCode in their allow-list.
 * Mismatch is FORBIDDEN (credential scope), not ENTITLEMENT_DENIED.
 * User JWTs may name a productCode; it still has to be present.
 */
function assertInferenceProduct(principal, productCode) {
    const code = productCode?.trim() ?? "";
    if (!code) {
        throw new errors_1.AiPlatformException("VALIDATION_ERROR", 400, "productCode is required");
    }
    if (principal.kind === "service" && !(principal.productCodes ?? []).includes(code)) {
        throw new errors_1.AiPlatformException("FORBIDDEN", 403, "productCode is outside the service credential scope");
    }
    return code;
}
function assertInternalService(principal) {
    if (principal.kind !== "service" || principal.internal !== true) {
        throw new errors_1.AiPlatformException("FORBIDDEN", 403, "internal service credential required");
    }
}
function normalize(value) {
    if (value == null)
        return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}
