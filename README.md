# Hair Coloration: category decision review

[![tests](https://github.com/glejdis/zenline-category-opportunity-review/actions/workflows/tests.yml/badge.svg)](https://github.com/glejdis/zenline-category-opportunity-review/actions/workflows/tests.yml)

[Published dashboard](https://glejdis.github.io/zenline-category-opportunity-review/) · [Readable review](outputs/category_review.md)

A small review for the fictional retailer **ZenBeauty Retail**. The customer question is:
**Which products need attention, what should we do next, and what evidence supports that decision?**

The artifact prioritises a handful of concrete decisions, not an automatic recommendation for every
business lever. The full list remains available for exploration. Inputs are synthetic; no recommendation
is an approved order, price change, range decision or task assignment.

## Run and inspect

Python 3.9+; no third-party dependencies or network access:

```console
python analyze.py
```

Open **`index.html`** or **`outputs/dashboard.html`** locally. Both are self-contained; no server is
needed. To reproduce a review with fixed freshness calculations:

```console
python analyze.py --as-of 2026-09-20
```

The published site reflects the last deployed commit, not uncommitted local changes.

## A category manager's walkthrough

1. **Start here:** read the selected product-level decisions, proposed owners, next actions and success measures.
2. **View evidence:** inspect status, stock, seasonality, raw metrics, source file/record/row, comparator observations and scenario calculations.
3. **Build a review plan:** add relevant decisions, record an owner, due date, accept/defer decision, progress and notes; export for the review meeting.
4. **Explore when needed:** filter by action, category, brand, supplier or private label; inspect the lower-priority charts and assortment watchlist.

Plan edits stay in this browser's local storage. They are **not shared or sent anywhere**. File URLs,
the hosted site and other browsers may not share storage. Storage errors and changed snapshots require
attention; export the plan before moving browsers or origins. Accepted means accepted for review/action
planning, not that an inventory or pricing system has been changed.

## Business judgment and guardrails

| Situation | Proposed review, not an automatic commercial action |
|---|---|
| Active, out/low stock, growing market proxy | Check availability first. Out-of-stock is distinct from low-stock; neither proves the amount of lost sales. |
| Active, in stock, zero revenue or units, growing market proxy | Investigate listing, distribution, barcode or sales-feed issues, even below the high-demand threshold. Check seasonality before promotion. |
| Inactive, growing market proxy | Review the reason for inactivity and possible reactivation; do not automatically delist. |
| Inactive without a growing signal | Confirm the existing range decision and residual stock before any clearance. |
| In-stock seller below its subcategory peer ratio, strong growing demand | Consider a small merchandising test after checking economics and product visibility. |
| Low margin on material sales | Validate cost and supplier terms; keep the gross-profit scenario separate from revenue. |
| Weak active sales with declining demand | Review product role. Seasonal items go to a seasonal review rather than an automatic exit. |
| Price/assortment comparator signal | Validate product form, pack, source freshness and supply before pricing or ranging decisions. |

Operational prerequisites take precedence over monetary size. Secondary flags remain visible, so
a stock problem cannot disappear behind a margin opportunity. Recommendations select up to five
real items in the documented review order, first taking one per primary action. Empty action types
do not generate cards.

## Evidence and financial assumptions

**Channel / market is a descriptive ratio, not verified market share.** The supplied market figures
are demand proxies. A low ratio alone does not establish poor execution, addressable demand or causation.

**Revenue scenario:** `max(0, market proxy × peer median ratio − channel revenue)`.
Peers are other active, in-stock SKUs with positive revenue, units and market proxy in the same
subcategory. The subject SKU is excluded. Peer IDs/counts and the calculation are visible.
No usable peer group means **not estimated**, not a fabricated zero or category-wide fallback.

**Gross-profit scenario:** `max(0, current revenue × (peer median margin − current margin))`.
This holds revenue constant; it is neither additional revenue nor net profit.

Both are **benchmark scenarios, not forecasts, guaranteed gains or statistical upper bounds**.
No annualisation, elasticity, promotional-cost or cannibalisation model is supported by this snapshot.
Zero and not estimated are displayed differently. Lifecycle and zero-sales investigations have no
monetary estimate.

Raw margin/trend `_pct` fields are fractional rates (`0.31` means 31%); derived
`channel_to_market_ratio_pct` and `peer_ratio_pct` values are percentage points. The dashboard formats
these separately and rounds displays for readability; calculations and exports retain their inputs.

Evidence labels describe limitations, not probability of success:
**Snapshot only**, **Needs context**, and **Limited comparison**. Thresholds remain explicit
heuristics in `CFG`, including top-third demand, bottom-quartile revenue, bottom-quintile margin,
and a 60-day competitor-refresh review threshold; these are not statistically learned cut-offs.

## Data quality and provenance

Inputs: 235 SKU rows, matching product metadata, and 75 competitor observations.
The original CSVs are unchanged.

- Competitor observations are dated **2026-07-01**. The review generation date is shown separately.
- The 12-week performance-window end and stock-snapshot date are **not supplied**.
- Four popularity scores exceed their stated 0–100 range. Raw values and record IDs remain visible,
  but those scores are excluded from popularity averages/ranking, not capped. Their price and trend
  fields remain separate, unverified observations.
- Source rows, IDs, observed dates and peer/comparator detail are carried into the dashboard,
  report and exports. Row counts are not assumed to be independent corroboration.
- Missing required columns, invalid numeric values, duplicate IDs and missing metadata fail with
  source context rather than silently becoming zero.

## Files and verification

`analyze.py` contains the stdlib analysis and rendering pipeline; `dashboard_template.html` contains
the UI. Keeping them separate makes both easier to inspect while the generated HTML remains standalone.

Generated files: `index.html`, `outputs/dashboard.html`, `outputs/category_review.md`,
`outputs/opportunities.csv`, `outputs/assortment_gaps.csv`, and `outputs/review.json` (full audit payload).
Regeneration replaces these artifacts, not a user's browser-local action plan. Snapshot IDs include
the source files and rule configuration; a fixed `--as-of` date makes generation reproducible.

```console
python -m unittest -v
node --test test_dashboard.cjs
```

Node 18+ is needed only for the optional dashboard logic tests, not to generate or use the artifact.
Coverage focuses on commercial guardrails, exact scenario math, input errors, evidence provenance,
CSV handling and the local decision workflow rather than merely freezing old recommendation counts.

## Tradeoffs and next improvements

This deliberately stops short of a shared workflow system, live ERP integration or learned forecast.
With customer access, validate data definitions and product roles first, then add stock-duration and
inventory history, verified like-for-like comparators, test costs/control groups, and outcome snapshots.
Shared assignments, authentication and cross-user synchronisation would require a backend.

AI tools assisted exploration and implementation. Every proposed decision is traceable to the supplied
data; assumptions and missing evidence are exposed rather than filled with invented certainty.
