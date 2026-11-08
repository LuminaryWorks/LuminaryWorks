# Privacy Policy (engineering template)

**NOT LEGAL ADVICE.** OVH-hosted production text for LuminaryWorks (`lw-legal-v2026-11-07`). Have a lawyer admitted in France review it. Chinese: [隐私政策](../zh/privacy.md).

Related: [Terms](./terms.md) · [Trial and Data Deletion](./trial-data-deletion.md) · [Entitlement spec](../../subscription-and-entitlement.md)

## 1. Roles

LuminaryWorks (启明工坊) is the platform operator. For platform account data, billing and entitlement records, policy-acceptance logs, and platform security logs, LuminaryWorks is the controller. The hosted service runs on OVH. Where the GDPR applies, that platform processing is subject to the GDPR and to French law; those rules are not waived. Registered address and registration number are those published at https://luminaryworks.dev/legal. Platform privacy contact: admin@luminaryworks.dev.

Each partner product is operated by its own operator. That partner operator is an independent controller for product data, including content, classrooms, recordings, device data, and other data the product stores to provide its own service. LuminaryWorks does not become the controller of partner content merely because a person signed in through the platform. To exercise rights about product data, contact that product's operator through the contact published on the product's own site. To exercise rights about the platform account or billing, contact LuminaryWorks.

When a partner uses the LuminaryWorks AI gateway, LuminaryWorks processes the prompts, model traffic, and usage metering needed to provide that gateway as a processor for the partner operator, under the partner agreement and its data-processing terms. The partner operator remains the controller of that product use. The gateway does not make LuminaryWorks the author of partner output.

In this policy, "Platform operator" means LuminaryWorks. "Partner operator" means the independent operator of a partner product.


## 2. Data we process

| Category | Examples | Purpose |
|----------|----------|---------|
| Identity | Logto `sub`, email, org membership | Sign-in, product access |
| Billing | Orders, payment attempts (no full card data), provider ids, refunds | Checkout, tax/audit, disputes |
| Policy acceptance | `policyVersion`, `acceptedAt`, IP, user agent, `logtoSub` | Record informed consent for Terms / Privacy / Trial deletion |
| Geo routing | Trusted CDN country or GeoIP of the connection | Choose payment providers; not a KYC document |
| Product content | Dashboards, classrooms, recordings, uploads, Doris demo tables | Provide the partner product you use. The partner operator is the controller for this data. |
| Telemetry / audit | Entitlement checks, admin actions, purge job ids | Security, quota, abuse prevention |

We do not use payment adapters that require our servers to collect card PAN/CVV. Crypto and local-wallet payments, when enabled, are handled by the listed provider.

## 3. Retention

| Data | Retention |
|------|-----------|
| Logto identity, orders, payments, audit, Trial redemption/usage records | Kept after Trial expiry for billing, fraud, and legal record-keeping |
| Trial **product** data (including MinIO objects and shared Doris tables created for that Trial) | Deleted asynchronously after `endsAt` as in [Trial and Data Deletion](./trial-data-deletion.md) |
| Paid product data | For the subscription term and any documented grace; not a permanent Free archive |

There is **no permanent Free tier** that keeps product workspaces forever without a paid plan or in-window Trial.

## 4. Storage and subprocessors (disclosure)

Object bytes are stored on **operator-hosted MinIO-compatible** disks (single-node Pilot; no public-cloud S3/R2 as the system of record). A CDN does not mean the object has left operator storage.

Shared Doris, if used, runs as a memory-capped Pilot on the same or designated demo host.

Payment providers (Alipay, PayPal, WeChat Pay, UnionPay, Stripe, Coinbase, OKX, BitPay, or Manual) receive only what is required to complete a charge. Private customers who bring their own MinIO endpoint are responsible for that environment.

## 5. Sharing

We share data with: identity hosting, payment providers you checkout with, email/notification delivery, and subprocessors needed to run the control plane. When you open a partner product, the identity data needed to sign you in is shared with that partner operator, which is an independent controller for its product data. We do not sell personal data.

## 6. Your choices

You may access account and billing views while the account exists. You must **export Trial data before `endsAt`**. After irreversible purge, product content cannot be restored even if you later pay.

To delete an identity, email admin@luminaryworks.dev from the account address. We verify that you control the account, then delete or anonymize identity data. Billing, payment, and audit records may be kept where the law requires.

## 7. Security

Secrets for payment providers are encrypted and are not shown in plaintext to consoles. Webhooks are verified on the raw request body.

## 8. International and children

Hosted routing may use country codes from a trusted proxy. The service runs on OVH. Where the GDPR applies, LuminaryWorks is the controller for the platform account and billing data in section 1, and French law is not waived. You must be at least 15 to create an account yourself. Anyone younger may use teaching features such as BlockyEdu only when a parent or other legal guardian consents and manages the account.

## 9. Changes

A new `policyVersion` will be published in-product. Trial activation requires accepting the current Trial deletion policy version.

Effective date: 2026-11-07. Version: `lw-legal-v2026-11-07`.
