import type { Repository } from "typeorm";
import type { PlanCode } from "./constants";
import { EntitlementException } from "./errors";
import { ProductEntity } from "../database/entities/product.entity";

type ProductLookup = Pick<Repository<ProductEntity>, "findOne">;

export async function assertTrialPlanAllowed(
  products: ProductLookup,
  productCode: string,
  planCode: PlanCode | null | undefined,
): Promise<ProductEntity | null> {
  if (planCode !== "trial") return null;

  const product = await products.findOne({
    where: { code: productCode, active: true },
  });
  if (!product) {
    throw new EntitlementException("NOT_FOUND", `Unknown product ${productCode}`, {
      productCode,
    });
  }
  if (product.trialPolicy === "disabled") {
    throw new EntitlementException(
      "PRODUCT_TRIAL_DISABLED",
      `Trials are disabled for product ${productCode}`,
      { productCode },
    );
  }
  return product;
}
