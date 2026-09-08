# Trial and Data Deletion Policy (engineering template)

**NOT LEGAL ADVICE.** Engineering template (`lw-legal-v2026-09-07`) describing how LuminaryWorks Hosted SaaS runs Trials. Chinese: [Trial 与数据删除政策](../zh/trial-data-deletion.md).

Related: [Terms](./terms.md) · [Privacy](./privacy.md) · [subscription-and-entitlement.md](../../subscription-and-entitlement.md)

**Activating a Trial requires an explicit, versioned acceptance of this policy.** If you do not accept the current `policyVersion`, the platform will not create a Trial.

## 1. No permanent Free plan

There is no perpetual Free membership. Without Trial or paid entitlement you may only sign in, open billing, and use public demos.

## 2. Which products offer Trial

| Product | Trial |
|---------|--------|
| DataLuminary, BlockyEdu, VistaRemote | One Trial per user per product: **7 × 24 hours** |
| DoerFlow | **No Trial** (`trialPolicy=disabled`) |
| VistaCast, SyncroBrain | Not sellable until readiness; **no Trial** until a later published policy says otherwise |

Enterprise contract and valid private license contexts do not receive a ToC Trial.

## 3. Clock and `endsAt`

Duration is **exactly 7 × 24 hours** from server `startsAt` to server `endsAt`. The server clock is authoritative. The product UI must show the exact `endsAt` and a countdown. Repeating “ensure Trial” does not extend the window.

## 4. Warnings: T-3 and T-1

If the Trial is still active and you have not upgraded:

- **T-3**: notice three days before `endsAt`
- **T-1**: notice one day before `endsAt`

Notices may be in-app, email, or push according to your preferences. An upgrade or qualifying enterprise entitlement **cancels** pending Trial notices and purge work.

You are responsible for using the export control **before** `endsAt`. We do not guarantee that late export after blocking will succeed.

## 5. At `endsAt`: immediate access block

When `endsAt` is reached, paid/Trial features are **revoked immediately**. API and UI return entitlement errors (typically HTTP 402). You can still sign in and view account, orders, and invoices.

Physical deletion does **not** need to finish at the same instant as the block.

## 6. Asynchronous irreversible deletion

After the block, the control plane enqueues a signed `trial.purge` job. Products delete **asynchronously**. Deletion is **irreversible**. Paying after the purge has completed does **not** reconstruct Trial files, recordings, Doris tables, or uploads.

Jobs are keyed by `trialRedemptionId` and billing owner, and are idempotent. Resources that were moved to a **paid organization** are not bulk-deleted by a vague “creator” match.

Before purge, the job re-checks that no valid paid subscription exists for that product. A successful payment races the purge with a lock: payment wins if entitlement is already paid; if bytes are already gone, payment does not invent a restore.

## 7. What is deleted vs kept

**Deleted (Trial product data), including for example:**

- Product-private records created under that Trial
- Sync tasks and checkpoints
- Shared Doris demo tables/data for that Trial
- MinIO-compatible objects and uploads (recordings, media, attachments) for that Trial

**Kept:**

- Logto identity and organization membership
- Orders, payment attempts, invoices, refunds
- Audit logs
- Trial redemption and usage counters needed to enforce “once per user per product”

## 8. Pilot infrastructure

Trial media and files sit on **single-node** object storage **without SLA**. Shared Doris is a **Pilot** under vendor minimum memory guidance. Capacity limits or disk watermarks may stop new Trial uploads before `endsAt`. That is not an extension of the Trial and does not create a Free archive.

## 9. Version

Effective date: 2026-09-07. Version: `lw-legal-v2026-09-07`.
