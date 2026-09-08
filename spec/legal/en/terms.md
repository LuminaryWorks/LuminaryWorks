# Terms of Service (engineering template)

**NOT LEGAL ADVICE.** This is an engineering contract template for LuminaryWorks Hosted SaaS (`lw-legal-v2026-09-07`). It is not a substitute for counsel. Replace operator legal names, addresses, and governing-law clauses before production publication.

Related: [Privacy](./privacy.md) · [Trial and Data Deletion](./trial-data-deletion.md) · [中文条款](../zh/terms.md) · [Entitlement spec](../../subscription-and-entitlement.md)

## 1. Operator and service

These Terms cover the LuminaryWorks hosted control plane and the product surfaces that use central identity and entitlement (including DataLuminary, BlockyEdu, VistaRemote, and DoerFlow). VistaCast and SyncroBrain may appear in account configuration when enabled by the operator; they are **not sold** on this platform until the operator marks them sellable.

There is **no permanent Free membership**. Without an active paid plan or an in-window Trial, you may sign in, view billing history, and use public demos only.

## 2. Accounts

You authenticate with the LuminaryWorks identity service (Logto). Your stable account key is the identity `sub`. You must keep credentials confidential and provide accurate billing contact information.

## 3. Plans, pricing, and payment

Paid plans are Pro, Ultra, or enterprise contract seats. Prices, currency, and term (30 or 365 days) are set by the server catalog at order time. Checkout amount cannot be set by the client. Renewal extends from `max(now, currentEndsAt)`.

Payment methods shown to you depend on trusted geo signals and operator-enabled providers. IP address is used for routing only and is not proof of crypto-payment compliance. Crypto checkouts, when offered, are blocked if either the trusted location or the account billing country is CN.

Refunds follow the payment platform and the provider that collected funds.

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

Governing law, venue, and consumer-rights carve-outs: **\[operator to insert\]**.

Effective date: 2026-09-07. Version: `lw-legal-v2026-09-07`.
