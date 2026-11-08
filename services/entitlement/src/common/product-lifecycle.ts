import type { Repository } from "typeorm";
import { ProductEntity } from "../database/entities/product.entity";
import {
  PRODUCT_LIFECYCLE_STATUSES,
  type EntitlementErrorCode,
  type ProductLifecycleStatus,
} from "./constants";
import { EntitlementException } from "./errors";

export { PRODUCT_LIFECYCLE_STATUSES, type ProductLifecycleStatus };

type ProductLookup = Pick<Repository<ProductEntity>, "findOne">;

export function isProductLifecycleStatus(value: string): value is ProductLifecycleStatus {
  return (PRODUCT_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

/** Missing or unknown values stay active so older rows and test fixtures keep selling. */
export function readLifecycleStatus(status: string | null | undefined): ProductLifecycleStatus {
  if (status === "suspended" || status === "retired") return status;
  return "active";
}

export function commerceBlockCode(
  status: string | null | undefined,
): Extract<EntitlementErrorCode, "PRODUCT_SUSPENDED" | "PRODUCT_RETIRED"> | null {
  const lifecycle = readLifecycleStatus(status);
  if (lifecycle === "suspended") return "PRODUCT_SUSPENDED";
  if (lifecycle === "retired") return "PRODUCT_RETIRED";
  return null;
}

export function assertCommerceOpen(product: { code: string; status?: string | null }): void {
  const code = commerceBlockCode(product.status);
  if (!code) return;
  const lifecycle = readLifecycleStatus(product.status);
  throw new EntitlementException(
    code,
    lifecycle === "suspended"
      ? `Product ${product.code} is suspended`
      : `Product ${product.code} is retired`,
    { productCode: product.code },
  );
}

export async function assertProductCommerceOpen(
  products: ProductLookup,
  productCode: string,
): Promise<ProductEntity> {
  const product = await products.findOne({ where: { code: productCode, active: true } });
  if (!product) {
    throw new EntitlementException("NOT_FOUND", `Unknown product ${productCode}`, { productCode });
  }
  assertCommerceOpen(product);
  return product;
}
