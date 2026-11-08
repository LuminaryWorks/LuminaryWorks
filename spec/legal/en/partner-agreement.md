# Partner agreement (engineering template)

**NOT LEGAL ADVICE.** Engineering template for counsel, version `lw-legal-v2026-11-07`. Have a lawyer admitted in France review, localize, and replace every placeholder before anyone signs it. This is not a joint venture, a partnership in the sense of a société, or a statement that LuminaryWorks owns the partner product.

Parties: LuminaryWorks (the platform operator; public name LuminaryWorks, 启明工坊; registered address as published at https://luminaryworks.dev/legal) and {{PARTNER_OPERATOR_NAME}} (the partner operator).

Related: [Takedown policy](./takedown-policy.md) · [Terms](./terms.md) · [Privacy](./privacy.md).

## 1. What the platform provides

LuminaryWorks provides platform services only: unified account (identity), billing and entitlement, an AI gateway, and notifications, plus the technical standards required to call those services.

For hosted checkout, LuminaryWorks is merchant of record and payment agent unless a signed order says otherwise. The partner product remains operated by {{PARTNER_OPERATOR_NAME}}. Listing a product on the platform is not an endorsement of its content.

## 2. Independence

{{PARTNER_OPERATOR_NAME}} keeps its own brand, domain, GitHub organization, support address, status page, release cadence, and product terms. It is the operator of the product, including content, intellectual property, and product-specific promises.

Nothing in this template makes the parties a single operating company, shares a domain registrant, or lets either party put the other's name in a footer as owner.

## 3. Revenue share and settlement

Hosted charges collected by LuminaryWorks are settled to {{PARTNER_OPERATOR_NAME}} on {{SETTLEMENT_CYCLE}} in {{SETTLEMENT_CURRENCY}}, after the revenue share of {{REVENUE_SHARE_PERCENT}} retained by LuminaryWorks and after the reserves in section 4.

The statement lists gross charges, refunds, chargebacks, reserves, the platform share, and the net amount. Taxes that the law places on the merchant of record are handled as the signed order specifies. No percentage in this template is a default commercial offer.

## 4. Refunds, chargebacks, and reserves

Refunds and chargebacks on hosted checkout are allocated to {{PARTNER_OPERATOR_NAME}}, except the portion that corresponds to a failure of the platform services themselves.

LuminaryWorks may hold a reserve of {{RESERVE_PERCENT}} for {{RESERVE_DAYS}} against refunds and chargebacks. Unused reserve is released on the next statement after that window. The reserve does not transfer ownership of the product or of user content.

## 5. Content, intellectual property, and indemnity

{{PARTNER_OPERATOR_NAME}} warrants that it has the rights required to operate the product and to make it available through the platform, and that the product does not infringe third-party intellectual property or violate applicable law.

{{PARTNER_OPERATOR_NAME}} indemnifies LuminaryWorks against claims that arise from partner content, partner intellectual property, or product-specific terms. LuminaryWorks indemnifies {{PARTNER_OPERATOR_NAME}} against claims that arise from the platform services themselves, not from partner content.

## 6. Notice and takedown

Intellectual-property notices follow [takedown-policy.md](./takedown-policy.md). LuminaryWorks may disable the partner product, or the material identified in a notice, on the platform. That action does not by itself suspend other partner products or the platform account service.

## 7. Data roles

LuminaryWorks is controller for platform account, billing, entitlement, and platform security logs. {{PARTNER_OPERATOR_NAME}} is controller for product data. Where the partner uses the AI gateway, LuminaryWorks processes prompts, model traffic, and usage records as a processor for {{PARTNER_OPERATOR_NAME}}.

A data-processing addendum, {{DPA_REFERENCE}}, is part of this agreement when the gateway or other processor services are used. Hosting of the platform on OVH, and the GDPR where it applies, are described in the privacy policy. This template does not move product-data controllership to LuminaryWorks.

## 8. AI acceptable use

The partner will not use the AI gateway to generate or distribute content that is unlawful, that infringes intellectual property, or that attempts to bypass platform quotas, geo rules, or entitlement. LuminaryWorks may suspend gateway access for that partner without suspending unrelated partners. The gateway does not make LuminaryWorks the author of model output.

## 9. Kill switch and suspension

LuminaryWorks may suspend the partner's platform access, catalog listing, and hosted checkout (a kill switch) if a notice, a legal order, a breach of this agreement, or a risk to the platform requires it. Suspension is limited to that partner. The partner's own self-hosted deployments are outside this switch unless they call the platform.

{{PARTNER_OPERATOR_NAME}} may stop using the platform on the notice period in the signed order. Stopping does not erase billing records the law requires LuminaryWorks to keep.

## 10. Termination and data return

Either party may terminate for uncured material breach after the notice stated in the signed order, or as that order allows for convenience.

On termination, LuminaryWorks stops hosted checkout and gateway access for that partner, returns or deletes partner content it holds as processor within {{DATA_RETURN_DAYS}} except for records it must keep, and pays amounts then due under sections 3 and 4. The partner keeps its product, its domain, and its user relationships outside the platform.

## 11. Governing law

Governing law: {{GOVERNING_LAW}}. Venue: {{VENUE}}. Mandatory consumer rules and the GDPR are not waived by this placeholder. Replace both placeholders with the clause the reviewing lawyer approves. Do not treat this file as signed terms.

Notices to the platform: admin@luminaryworks.dev. Notices to the partner: {{PARTNER_NOTICE_EMAIL}}.

Effective date: 2026-11-07. Version: `lw-legal-v2026-11-07`.
