import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EntitlementConfig } from "../../config/entitlement.config";
import {
  directPeerFromRequest,
  resolveGeoContext,
  type GeoContext,
  type GeoHeaderMap,
} from "../../common/payment-geo";
import { hostedMarketForCountry } from "../../common/payment-providers";
import type { BillingMarket } from "../../common/catalog-pricing";

@Injectable()
export class PaymentGeoService {
  constructor(private readonly config: ConfigService) {}

  private conf(): EntitlementConfig {
    return this.config.getOrThrow<EntitlementConfig>("entitlement");
  }

  resolve(input: { directPeerIp: string | null; headers: GeoHeaderMap }): GeoContext {
    const conf = this.conf();
    return resolveGeoContext({
      directPeerIp: input.directPeerIp,
      headers: input.headers,
      trustedProxies: conf.paymentTrustedProxies,
      defaultCountry: conf.paymentGeoDefaultCountry,
    });
  }

  resolveFromRequest(req: {
    headers: GeoHeaderMap;
    socket?: { remoteAddress?: string };
    raw?: { socket?: { remoteAddress?: string } };
  }): GeoContext {
    return this.resolve({
      directPeerIp: directPeerFromRequest(req),
      headers: req.headers,
    });
  }

  marketFor(country: string | null): BillingMarket {
    return hostedMarketForCountry(country);
  }
}
