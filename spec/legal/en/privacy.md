# Privacy Policy (engineering template)

**NOT LEGAL ADVICE.** Engineering template for LuminaryWorks Hosted SaaS (`lw-legal-v2026-09-07`). Have qualified counsel review before production. Chinese: [隐私政策](../zh/privacy.md).

Related: [Terms](./terms.md) · [Trial and Data Deletion](./trial-data-deletion.md) · [Entitlement spec](../../subscription-and-entitlement.md)

## 1. Who we are

The operator of LuminaryWorks Hosted SaaS processes account, billing, and product data to provide identity, entitlement, payments, and product features. Legal entity, contact, and DPO/representative: **\[operator to insert\]**.

## 2. Data we process

| Category | Examples | Purpose |
|----------|----------|---------|
| Identity | Logto `sub`, email, org membership | Sign-in, product access |
| Billing | Orders, payment attempts (no full card data), provider ids, refunds | Checkout, tax/audit, disputes |
| Policy acceptance | `policyVersion`, `acceptedAt`, IP, user agent, `logtoSub` | Record informed consent for Terms / Privacy / Trial deletion |
| Geo routing | Trusted CDN country or GeoIP of the connection | Choose payment providers; not a KYC document |
| Product content | Dashboards, classrooms, recordings, uploads, Doris demo tables | Provide the product you use |
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

We share data with: identity hosting, payment providers you checkout with, email/notification delivery, and subprocessors needed to run the control plane. We do not sell personal data.

## 6. Your choices

You may access account and billing views while the account exists. You must **export Trial data before `endsAt`**. After irreversible purge, product content cannot be restored even if you later pay.

To request identity deletion beyond these policies: **\[operator to insert process\]**. Billing and audit records may still be retained where law requires.

## 7. Security

Secrets for payment providers are encrypted and are not shown in plaintext to consoles. Webhooks are verified on the raw request body.

## 8. International and children

Hosted routing may use country codes from a trusted proxy. Do not use the service if you are below the minimum age required in your jurisdiction. **\[operator to insert\]**.

## 9. Changes

A new `policyVersion` will be published in-product. Trial activation requires accepting the current Trial deletion policy version.

Effective date: 2026-09-07. Version: `lw-legal-v2026-09-07`.
