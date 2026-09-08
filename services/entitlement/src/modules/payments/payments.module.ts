import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BillingProfileEntity } from "../../database/entities/billing-profile.entity";
import { GrantEntity } from "../../database/entities/grant.entity";
import { OrderEntity } from "../../database/entities/order.entity";
import { OutboxEventEntity } from "../../database/entities/outbox-event.entity";
import { PaymentAttemptEntity } from "../../database/entities/payment-attempt.entity";
import { PaymentProviderConfigEntity } from "../../database/entities/payment-provider-config.entity";
import { ProviderWebhookEventEntity } from "../../database/entities/provider-webhook-event.entity";
import { RefundEntity } from "../../database/entities/refund.entity";
import { SubscriptionEntity } from "../../database/entities/subscription.entity";
import { AuditModule } from "../audit/audit.module";
import {
  ContractPaymentAdapter,
  ManualPaymentAdapter,
  MockPaymentAdapter,
  UnimplementedPaymentAdapter,
  UNIMPLEMENTED_PROVIDER_IDS,
} from "./adapters";
import { AlipayF2fPaymentAdapter } from "./alipay-f2f.adapter";
import { BitpayPaymentAdapter } from "./bitpay.adapter";
import { BillingProfileController } from "./billing-profile.controller";
import { BillingProfileService } from "./billing-profile.service";
import { CoinbaseCommercePaymentAdapter } from "./coinbase-commerce.adapter";
import { defaultCoinbaseJwtSigner } from "./coinbase-cdp-auth";
import { OkxOnchainPaymentAdapter } from "./okx-onchain.adapter";
import { defaultBitpayMerchantFactory } from "./bitpay-sdk";
import { defaultOkxX402Factory } from "./okx-x402-sdk";
import { PaymentAdminController, PaymentMethodsController } from "./payment-admin.controller";
import { PaymentConfigAdminController } from "./payment-config-admin.controller";
import { PaymentConfigService } from "./payment-config.service";
import { PaymentGeoService } from "./payment-geo.service";
import { PaymentWebhookController } from "./payment-webhook.controller";
import { PaymentWebhookService } from "./payment-webhook.service";
import { PAYMENT_ADAPTERS } from "./payment-adapter";
import {
  defaultPaymentClock,
  defaultPaymentFetch,
  BITPAY_MERCHANT_FACTORY,
  COINBASE_JWT_SIGNER,
  OKX_X402_FACTORY,
  PAYMENT_CLOCK,
  PAYMENT_FETCH,
} from "./payment-runtime";
import { PaypalPaymentAdapter } from "./paypal.adapter";
import { PaymentsService } from "./payments.service";
import { StripeCheckoutPaymentAdapter } from "./stripe-checkout.adapter";
import { UnionpayQuickpassPaymentAdapter } from "./unionpay-quickpass.adapter";
import { WechatPayV3PaymentAdapter } from "./wechat-pay-v3.adapter";

@Module({
  imports: [
    AuditModule,
    TypeOrmModule.forFeature([
      PaymentProviderConfigEntity,
      PaymentAttemptEntity,
      ProviderWebhookEventEntity,
      RefundEntity,
      BillingProfileEntity,
      OrderEntity,
      GrantEntity,
      SubscriptionEntity,
      OutboxEventEntity,
    ]),
  ],
  controllers: [
    PaymentConfigAdminController,
    PaymentAdminController,
    PaymentMethodsController,
    PaymentWebhookController,
    BillingProfileController,
  ],
  providers: [
    { provide: PAYMENT_FETCH, useFactory: defaultPaymentFetch },
    { provide: PAYMENT_CLOCK, useValue: defaultPaymentClock },
    { provide: COINBASE_JWT_SIGNER, useFactory: defaultCoinbaseJwtSigner },
    { provide: OKX_X402_FACTORY, useFactory: defaultOkxX402Factory },
    { provide: BITPAY_MERCHANT_FACTORY, useFactory: defaultBitpayMerchantFactory },
    MockPaymentAdapter,
    ManualPaymentAdapter,
    ContractPaymentAdapter,
    AlipayF2fPaymentAdapter,
    PaypalPaymentAdapter,
    WechatPayV3PaymentAdapter,
    UnionpayQuickpassPaymentAdapter,
    StripeCheckoutPaymentAdapter,
    CoinbaseCommercePaymentAdapter,
    OkxOnchainPaymentAdapter,
    BitpayPaymentAdapter,
    {
      provide: PAYMENT_ADAPTERS,
      useFactory: (
        mock: MockPaymentAdapter,
        manual: ManualPaymentAdapter,
        contract: ContractPaymentAdapter,
        alipay: AlipayF2fPaymentAdapter,
        paypal: PaypalPaymentAdapter,
        wechat: WechatPayV3PaymentAdapter,
        unionpay: UnionpayQuickpassPaymentAdapter,
        stripe: StripeCheckoutPaymentAdapter,
        coinbase: CoinbaseCommercePaymentAdapter,
        okx: OkxOnchainPaymentAdapter,
        bitpay: BitpayPaymentAdapter,
      ) => [
        mock,
        manual,
        contract,
        alipay,
        paypal,
        wechat,
        unionpay,
        stripe,
        coinbase,
        okx,
        bitpay,
        ...UNIMPLEMENTED_PROVIDER_IDS.map((provider) => new UnimplementedPaymentAdapter(provider)),
      ],
      inject: [
        MockPaymentAdapter,
        ManualPaymentAdapter,
        ContractPaymentAdapter,
        AlipayF2fPaymentAdapter,
        PaypalPaymentAdapter,
        WechatPayV3PaymentAdapter,
        UnionpayQuickpassPaymentAdapter,
        StripeCheckoutPaymentAdapter,
        CoinbaseCommercePaymentAdapter,
        OkxOnchainPaymentAdapter,
        BitpayPaymentAdapter,
      ],
    },
    PaymentConfigService,
    PaymentGeoService,
    BillingProfileService,
    PaymentsService,
    PaymentWebhookService,
  ],
  exports: [
    PAYMENT_ADAPTERS,
    PaymentConfigService,
    PaymentGeoService,
    BillingProfileService,
    PaymentsService,
    MockPaymentAdapter,
    ManualPaymentAdapter,
    ContractPaymentAdapter,
    AlipayF2fPaymentAdapter,
    PaypalPaymentAdapter,
    WechatPayV3PaymentAdapter,
    UnionpayQuickpassPaymentAdapter,
    StripeCheckoutPaymentAdapter,
    CoinbaseCommercePaymentAdapter,
    OkxOnchainPaymentAdapter,
    BitpayPaymentAdapter,
  ],
})
export class PaymentsModule {}
