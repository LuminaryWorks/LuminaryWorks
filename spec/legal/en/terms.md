# Terms of Service (engineering template)

**NOT LEGAL ADVICE.** This is the OVH-hosted production text for LuminaryWorks (`lw-legal-v2026-11-07`). Have a lawyer admitted in France review it. The platform operator's public name is LuminaryWorks (启明工坊). Partner products are operated by their own operators. Registered address and registration number are those published in the header of [luminaryworks.dev/legal](https://luminaryworks.dev/legal).

Related: [Privacy](./privacy.md) · [Trial and Data Deletion](./trial-data-deletion.md) · [中文条款](../zh/terms.md) · [Entitlement spec](../../subscription-and-entitlement.md)

## 1. Platform operator, partner products, and the service

LuminaryWorks provides platform services to independent partner products. Those services are a unified account (identity), billing and entitlement, an AI gateway, and notifications, together with the technical standards needed to call them. For hosted checkout, LuminaryWorks is merchant of record and payment agent.

Partner products, including DataLuminary, BlockyEdu, VistaRemote, VistaCast, DoerFlow, and SyncroBrain, and any later partner, are operated by their own operators. Each partner operator is responsible for that product's content, intellectual property, and product-specific service terms. A product being available through the LuminaryWorks Platform is not a statement that LuminaryWorks authors, owns, or endorses it.

LuminaryWorks does not endorse or warrant partner content, partner intellectual property, or a partner's product-specific promises. Product terms are published on the partner product's own domain. Questions about product content, product intellectual property, or product-specific service go to that product's operator. Questions about the platform account, hosted checkout, entitlement, or these platform terms go to LuminaryWorks at admin@luminaryworks.dev.

LuminaryWorks may suspend or remove one partner product, or material on it, after a notice, a legal order, a partner-agreement breach, or a risk to the platform. That step does not suspend other partner products or the platform account service. A notice should identify the notifier, the partner product, the material, the right asserted, and a good-faith basis, and should be sent to admin@luminaryworks.dev and to the partner operator. The partner operator may send a counter-notice to the same platform address. Repeat notices about the same partner can lead to suspension of that partner only.

VistaCast and SyncroBrain may appear in account configuration when enabled; they are not sold on this platform until marked sellable. There is **no permanent Free membership**. Without an active paid plan or an in-window Trial, you may sign in, view billing history, and use public demos only.

In these Terms, "Platform operator" means LuminaryWorks. "Partner operator" means the independent operator of a partner product. A sentence that says "the operator" without the word "partner" means the Platform operator.


## 2. Accounts

You authenticate with the LuminaryWorks identity service (Logto). Your stable account key is the identity `sub`. You must keep credentials confidential and provide accurate billing contact information.

## 3. Plans, pricing, and payment

Paid plans are Pro, Ultra, or enterprise contract seats. Prices, currency, and term (30 or 365 days) are set by the server catalog at order time. Checkout amount cannot be set by the client. Renewal extends from `max(now, currentEndsAt)`.

Payment methods shown to you depend on trusted geo signals and operator-enabled providers. IP address is used for routing only and is not proof of crypto-payment compliance. Crypto checkouts, when offered, are blocked if either the trusted location or the account billing country is CN.

Refunds follow the payment platform and the provider that collected funds. For hosted checkout, LuminaryWorks is merchant of record and payment agent. How refunds, chargebacks, and reserves are split with a partner operator is set in the partner agreement. That split does not make LuminaryWorks the author of partner content.

## 4. Trials

Eligible products may offer a **single** Trial of **7 × 24 hours** per user per product, starting at `startsAt` and ending at an exact server `endsAt`. DoerFlow has **no Trial**. Activating a Trial requires **explicit acceptance** of the then-current versions of these Terms, the Privacy Policy, and the Trial and Data Deletion Policy. See [Trial and Data Deletion](./trial-data-deletion.md).

## 5. Infrastructure disclosure (Pilot)

Hosted object storage is a **single-node MinIO-compatible** service (AIStor Free or equivalent) with **no HA and no SLA**. A CDN, if used, does not remove your data from operator disks.

Shared Apache Doris analytics, if offered, is an **on-demand Pilot** capped far below vendor production guidance (combined FE+BE memory on the order of 6 GB / 25% of a 24 GB host). It may be slow, queued, or unavailable (`DORIS_DEMO_BUSY`). It is not a production warehouse SLA.

Private deployments must not rely on redistribution of AIStor binaries inside product packs; the customer installs and accepts storage software separately or supplies their own endpoint.

## 6. Acceptable use

You will not probe, overload, or abuse shared Trial storage, Doris demo capacity, or payment callbacks; will not upload unlawful content; and will not attempt to bypass geo, entitlement, or quota controls.

## 7. Suspension and deletion

When a Trial or paid term ends, **access to paid product features is blocked immediately**. Trial product data is then deleted asynchronously and irreversibly as described in the Trial and Data Deletion Policy. Identity, orders, payments, and audit records are retained as stated there.

## 8. Export

You are responsible for exporting any Trial or account data you need **before** `endsAt`. The operator provides an in-product export path while access remains; failure to export is not grounds to restore purged Trial data.

## 9. Changes

The operator may publish a new `policyVersion`. Continued account use after notice constitutes acceptance of Terms and Privacy updates where permitted by law. **Trial activation always requires a fresh explicit accept** of the current Trial policy version.

## 10. Disclaimer and limitation (template)

THE SERVICE IS PROVIDED WITHOUT WARRANTY OF AVAILABILITY, DURABILITY, OR FITNESS. SINGLE-NODE STORAGE AND PILOT DORIS ARE PROVIDED AS-IS. TO THE MAXIMUM EXTENT PERMITTED BY LAW, LIABILITY IS LIMITED TO FEES PAID FOR THE THEN-CURRENT TERM.

These Terms are governed by French law. Mandatory consumer-protection rules of the European Union and of your country of residence, and the GDPR, are not waived. Disputes are heard by the French courts that have jurisdiction at the operator's registered seat. If you are a consumer, you may still sue in the courts allowed by the law of your residence.

You must be at least 15 years old to create an account yourself. Privacy and deletion requests: admin@luminaryworks.dev.

Effective date: 2026-11-07. Version: `lw-legal-v2026-11-07`.
