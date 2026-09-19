#!/usr/bin/env python3
"""
Category Opportunity Review - analysis pipeline
================================================

Customer: ZenBeauty Retail (fictional German drugstore) | Category: Beauty > Hair Coloration

Reads the three source CSVs, derives execution/pricing signals, and applies five
deterministic, evidence-backed rules that map 1:1 to the customer's in-scope
business actions:

    1. FIX AVAILABILITY   active SKUs that are out/low on stock while demand rises
    2. PROMOTE            in-stock SKUs with strong, growing demand we under-capture
    3. DELIST / MARKDOWN  inactive or dead SKUs with no traction and falling demand
    4. PRICE / MARGIN      thin-margin volume sellers + SKUs priced far above benchmark
    5. ASSORTMENT GAP     competitor demand cells where we are absent or thin (supplier follow-up)

Outputs (written to ./outputs and ./outputs/dashboard.html):
    - opportunities.csv       one row per flagged SKU with action, value and evidence
    - assortment_gaps.csv     cell-level (subcategory x shade) gaps
    - category_review.md      readable review with the ranked recommendations
    - dashboard.html          self-contained interactive artifact (data inlined)

No third-party dependencies. Deterministic: same input -> same output.
Run:  python analyze.py
"""

from __future__ import annotations
import csv
import json
import os
from datetime import date

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "outputs")

# --------------------------------------------------------------------------------------
# Tunable thresholds. Percentile-based ones are computed from the data at runtime; the
# few absolute cut-offs below are documented in the README so every rule is auditable.
# --------------------------------------------------------------------------------------
CFG = {
    "mkt_rev_strong_pctl": 0.66,   # "strong market demand" = top third of market revenue
    "chan_rev_low_pctl": 0.25,     # "no channel traction" = bottom quartile of channel revenue
    "margin_low_pctl": 0.20,       # "thin margin" = bottom quintile of channel margin
    "volume_seller_pctl": 0.60,    # "volume seller" = top 40% of channel revenue
    "promote_min_mkt_trend": 0.05, # market must be growing >5% to justify promotion
    "price_index_flag": 1.15,      # priced >15% above competitor benchmark = review
    "gap_signal_min": 60.0,        # competitor popularity score that marks a demand cell
    "gap_trend_min": 0.25,         # or competitor trend that marks a demand cell
    "gap_max_active_cover": 1,     # we hold <=1 active SKU in that cell -> assortment gap
}


# ----------------------------------------- IO -----------------------------------------
def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def to_float(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def to_int(v, default=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def to_bool(v):
    return str(v).strip().lower() in ("true", "1", "yes")


def percentile(values, q):
    """Linear-interpolation percentile (matches numpy's default)."""
    xs = sorted(values)
    if not xs:
        return 0.0
    if q <= 0:
        return xs[0]
    if q >= 1:
        return xs[-1]
    pos = q * (len(xs) - 1)
    lo = int(pos)
    frac = pos - lo
    if lo + 1 < len(xs):
        return xs[lo] + frac * (xs[lo + 1] - xs[lo])
    return xs[lo]


def median(values):
    return percentile(values, 0.5)


def eur(x):
    return f"€{x:,.0f}"


# ------------------------------------- Load & derive ----------------------------------
def load():
    sku = read_csv(os.path.join(BASE, "sku_performance.csv"))
    meta = read_csv(os.path.join(BASE, "product_metadata.csv"))
    comp = read_csv(os.path.join(BASE, "competitor_market_signals.csv"))

    meta_by_id = {m["product_id"]: m for m in meta}

    num_sku = ("price_eur", "channel_revenue_eur_12w", "channel_units_sold_12w",
               "channel_margin_pct", "channel_sales_trend_12w_pct",
               "market_revenue_eur_12w", "market_units_sold_12w", "market_sales_trend_12w_pct")
    for r in sku:
        for c in num_sku:
            r[c] = to_float(r[c])
        r["private_label"] = to_bool(r["private_label"])
        m = meta_by_id.get(r["product_id"], {})
        r["shelf_space_cm"] = to_float(m.get("shelf_space_cm"), 0.0)
        r["supplier"] = m.get("supplier", "")
        # execution efficiency: share of wider-market demand we actually capture
        r["chan_share"] = (r["channel_revenue_eur_12w"] / r["market_revenue_eur_12w"]
                           if r["market_revenue_eur_12w"] > 0 else 0.0)

    for c in comp:
        for k in ("price_eur", "rank_or_popularity_signal", "signal_score_0_100", "trend_score_12w_pct"):
            c[k] = to_float(c[k])
    return sku, comp


def competitor_benchmarks(comp):
    """Median competitor price and mean demand signals per (subcategory, shade_group)."""
    cells = {}
    for c in comp:
        key = (c["subcategory"], c["shade_group"])
        cells.setdefault(key, {"prices": [], "signal": [], "trend": []})
        cells[key]["prices"].append(c["price_eur"])
        cells[key]["signal"].append(c["signal_score_0_100"])
        cells[key]["trend"].append(c["trend_score_12w_pct"])
    bench = {}
    for key, d in cells.items():
        bench[key] = {
            "comp_med_price": median(d["prices"]),
            "comp_signal": sum(d["signal"]) / len(d["signal"]),
            "comp_trend": sum(d["trend"]) / len(d["trend"]),
            "comp_n": len(d["prices"]),
        }
    return bench


# ------------------------------------- Classification ---------------------------------
def classify(sku, bench):
    rev = [s["channel_revenue_eur_12w"] for s in sku]
    mkt = [s["market_revenue_eur_12w"] for s in sku]
    margin = [s["channel_margin_pct"] for s in sku]

    T = {
        "mkt_rev_strong": percentile(mkt, CFG["mkt_rev_strong_pctl"]),
        "chan_rev_low": percentile(rev, CFG["chan_rev_low_pctl"]),
        "margin_low": percentile(margin, CFG["margin_low_pctl"]),
        "volume_seller": percentile(rev, CFG["volume_seller_pctl"]),
    }
    active = [s for s in sku if s["status"] == "aktiv" and s["stock_status"] != "out_of_stock"]
    chan_share_med = median([s["chan_share"] for s in active]) or median([s["chan_share"] for s in sku])

    # per-subcategory benchmarks used to model "what typical execution would yield"
    subcats = sorted({s["subcategory"] for s in sku})
    sub_share, sub_margin = {}, {}
    for sc in subcats:
        act = [s for s in active if s["subcategory"] == sc]
        allsc = [s for s in sku if s["subcategory"] == sc]
        sub_share[sc] = median([s["chan_share"] for s in act]) if act else chan_share_med
        sub_margin[sc] = median([s["channel_margin_pct"] for s in allsc])

    def potential_and_gap(s):
        pot = s["market_revenue_eur_12w"] * sub_share[s["subcategory"]]
        return pot, max(0.0, pot - s["channel_revenue_eur_12w"])

    flagged = []
    for s in sku:
        b = bench.get((s["subcategory"], s["shade_group"]))
        price_index = (s["price_eur"] / b["comp_med_price"]
                       if b and b["comp_med_price"] > 0 else None)
        pot, gap = potential_and_gap(s)

        actions = []  # (action, value_eur, rationale)

        # 1) FIX AVAILABILITY -- active, demand rising, but not buyable
        if s["status"] == "aktiv" and s["stock_status"] in ("out_of_stock", "low_stock") \
                and s["market_sales_trend_12w_pct"] > 0:
            actions.append(("Fix availability", gap,
                            f"{s['stock_status'].replace('_',' ')} while market demand is "
                            f"{s['market_sales_trend_12w_pct']*100:+.0f}% (12w)"))

        # 2) PROMOTE -- in stock, strong & growing demand, we under-capture it
        if s["status"] == "aktiv" and s["stock_status"] == "in_stock" \
                and s["market_revenue_eur_12w"] >= T["mkt_rev_strong"] \
                and s["market_sales_trend_12w_pct"] > CFG["promote_min_mkt_trend"] \
                and s["chan_share"] < chan_share_med:
            actions.append(("Promote", gap,
                            f"top-tercile demand {eur(s['market_revenue_eur_12w'])} "
                            f"({s['market_sales_trend_12w_pct']*100:+.0f}% 12w) but only "
                            f"{s['chan_share']*100:.1f}% channel share"))

        # 3) DELIST / MARKDOWN -- no traction, demand falling, or already inactive
        if s["status"] == "inaktiv" or (
                s["channel_revenue_eur_12w"] <= T["chan_rev_low"]
                and s["market_sales_trend_12w_pct"] < 0
                and s["channel_sales_trend_12w_pct"] <= 0):
            reason = ("marked inaktiv" if s["status"] == "inaktiv"
                      else f"{eur(s['channel_revenue_eur_12w'])} channel rev, demand "
                           f"{s['market_sales_trend_12w_pct']*100:+.0f}%")
            actions.append(("Delist / markdown", 0.0,
                            f"{reason}; frees {s['shelf_space_cm']:.0f} cm shelf"))

        # 4) PRICE / MARGIN REVIEW -- thin margin on a seller, or priced far above benchmark
        if s["channel_margin_pct"] <= T["margin_low"] and s["channel_revenue_eur_12w"] >= T["volume_seller"]:
            target = sub_margin[s["subcategory"]]
            uplift = max(0.0, s["channel_revenue_eur_12w"] * (target - s["channel_margin_pct"]))
            actions.append(("Price / margin", uplift,
                            f"{s['channel_margin_pct']*100:.0f}% margin on {eur(s['channel_revenue_eur_12w'])} "
                            f"seller vs {target*100:.0f}% subcategory median"))
        elif price_index and price_index > CFG["price_index_flag"] \
                and s["status"] == "aktiv" and s["channel_sales_trend_12w_pct"] < 0:
            actions.append(("Price / margin", 0.0,
                            f"priced {price_index:.1f}x competitor benchmark ({eur(s['price_eur'])} vs "
                            f"{eur(b['comp_med_price'])}) and declining {s['channel_sales_trend_12w_pct']*100:+.0f}%"))

        if not actions:
            continue

        # Priority order decides the primary action; the rest become secondary flags.
        priority = {"Fix availability": 0, "Promote": 1, "Price / margin": 2, "Delist / markdown": 3}
        actions.sort(key=lambda a: priority[a[0]])
        primary_action, value_eur, rationale = actions[0]
        # if a revenue action co-exists, prefer the larger-value one as primary
        rev_actions = [a for a in actions if a[1] > 0]
        if rev_actions:
            best = max(rev_actions, key=lambda a: a[1])
            if best[0] != "Delist / markdown":
                primary_action, value_eur, rationale = best

        flagged.append({
            "product_id": s["product_id"], "product_name": s["product_name"],
            "brand": s["brand"], "subcategory": s["subcategory"], "shade_group": s["shade_group"],
            "supplier": s["supplier"], "private_label": s["private_label"],
            "status": s["status"], "stock_status": s["stock_status"],
            "price_eur": round(s["price_eur"], 2),
            "comp_benchmark_price_eur": round(b["comp_med_price"], 2) if b else None,
            "price_index": round(price_index, 2) if price_index else None,
            "channel_revenue_eur_12w": round(s["channel_revenue_eur_12w"], 0),
            "channel_units_12w": to_int(s["channel_units_sold_12w"]),
            "channel_margin_pct": round(s["channel_margin_pct"], 3),
            "channel_trend_12w_pct": round(s["channel_sales_trend_12w_pct"], 3),
            "market_revenue_eur_12w": round(s["market_revenue_eur_12w"], 0),
            "market_trend_12w_pct": round(s["market_sales_trend_12w_pct"], 3),
            "channel_share_pct": round(s["chan_share"] * 100, 2),
            "modeled_potential_eur": round(pot, 0),
            "shelf_space_cm": round(s["shelf_space_cm"], 0),
            "primary_action": primary_action,
            "opportunity_value_eur": round(value_eur, 0),
            "rationale": rationale,
            "also_flagged": "; ".join(a[0] for a in actions if a[0] != primary_action),
        })

    # normalized 0-100 priority for display bars
    maxv = max((f["opportunity_value_eur"] for f in flagged), default=0) or 1
    for f in flagged:
        f["priority_score"] = round(100 * f["opportunity_value_eur"] / maxv, 1)
    flagged.sort(key=lambda f: f["opportunity_value_eur"], reverse=True)
    return flagged, T, chan_share_med


def assortment_gaps(sku, bench):
    gaps = []
    for (sc, shade), b in bench.items():
        cover = [s for s in sku if s["subcategory"] == sc and s["shade_group"] == shade
                 and s["status"] == "aktiv" and s["stock_status"] != "out_of_stock"]
        strong = b["comp_signal"] >= CFG["gap_signal_min"] or b["comp_trend"] >= CFG["gap_trend_min"]
        if strong and len(cover) <= CFG["gap_max_active_cover"]:
            # blended priority: popularity is the robust signal, trend a bounded multiplier
            gap_score = b["comp_signal"] * (1 + max(0.0, min(b["comp_trend"], 0.6)))
            gaps.append({
                "subcategory": sc, "shade_group": shade,
                "gap_score": round(gap_score, 1),
                "competitor_signal_0_100": round(b["comp_signal"], 1),
                "competitor_trend_12w_pct": round(b["comp_trend"], 3),
                "competitor_rows": b["comp_n"],
                "active_skus_held": len(cover),
                "channel_revenue_eur_12w": round(sum(s["channel_revenue_eur_12w"] for s in cover), 0),
            })
    gaps.sort(key=lambda g: g["gap_score"], reverse=True)
    return gaps


# ------------------------------------- Reporting --------------------------------------
def write_csv(path, rows, fields):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k) for k in fields})


def build_summary(sku, flagged, gaps):
    by_action = {}
    for f in flagged:
        by_action.setdefault(f["primary_action"], {"n": 0, "value": 0.0})
        by_action[f["primary_action"]]["n"] += 1
        by_action[f["primary_action"]]["value"] += f["opportunity_value_eur"]
    chan = sum(s["channel_revenue_eur_12w"] for s in sku)
    mkt = sum(s["market_revenue_eur_12w"] for s in sku)
    avail = sum(a["value"] for k, a in by_action.items() if k == "Fix availability")
    promo = sum(a["value"] for k, a in by_action.items() if k == "Promote")
    margin = sum(a["value"] for k, a in by_action.items() if k == "Price / margin")
    delist_n = by_action.get("Delist / markdown", {}).get("n", 0)
    shelf = sum(f["shelf_space_cm"] for f in flagged if f["primary_action"] == "Delist / markdown")
    return {
        "n_skus": len(sku),
        "channel_rev": chan, "market_rev": mkt, "channel_share_pct": 100 * chan / mkt,
        "by_action": by_action,
        "upside_availability": avail, "upside_promote": promo, "upside_margin": margin,
        "total_revenue_upside": avail + promo, "delist_n": delist_n, "shelf_freed_cm": shelf,
        "n_gaps": len(gaps),
    }


def recommendations(flagged, gaps, S):
    """Assemble the ranked, evidence-backed recommendations (data-driven, no hardcoding)."""
    def top(action, n=3):
        rows = [f for f in flagged if f["primary_action"] == action]
        if action == "Delist / markdown":
            rows = sorted(rows, key=lambda f: f["shelf_space_cm"], reverse=True)
        return rows[:n]

    recs = []
    recs.append({
        "title": "Fix availability on in-demand active SKUs — fastest recoverable revenue",
        "action": "Fix availability",
        "why": (f"{S['by_action'].get('Fix availability',{}).get('n',0)} active SKUs are out- or low-stock "
                f"while their market demand is still growing. Modeled recoverable channel revenue is up to "
                f"{eur(S['upside_availability'])} (ceiling — near-term capture is a fraction)."),
        "evidence": top("Fix availability"),
        "do": "Expedite replenishment / set safety stock on the listed SKUs before the category review.",
    })
    recs.append({
        "title": "Promote strong-demand SKUs we are under-executing",
        "action": "Promote",
        "why": (f"{S['by_action'].get('Promote',{}).get('n',0)} in-stock active SKUs sit in the top third of "
                f"market demand and are still rising, yet we capture below-median channel share. Modeled "
                f"execution upside up to {eur(S['upside_promote'])}."),
        "evidence": top("Promote"),
        "do": "Feature in category promo / gondola ends / online merchandising and monitor share for 12w.",
    })
    recs.append({
        "title": "Delist or mark down dead SKUs to free shelf space and working capital",
        "action": "Delist / markdown",
        "why": (f"{S['delist_n']} SKUs are inactive or have no channel traction with falling demand. "
                f"Delisting frees ~{S['shelf_freed_cm']:.0f} cm of shelf to reallocate to the promote / gap SKUs."),
        "evidence": top("Delist / markdown", 4),
        "do": "Delist at next review; clear residual stock via markdown; reallocate facings.",
    })
    recs.append({
        "title": "Repair margin on volume sellers and review off-benchmark prices",
        "action": "Price / margin",
        "why": (f"Several high-volume SKUs run bottom-quintile margin; lifting them toward the subcategory "
                f"median is worth up to {eur(S['upside_margin'])}. A handful of fashion-colour SKUs are also "
                f"priced well above the nearest competitor benchmark while declining."),
        "evidence": top("Price / margin"),
        "do": "Renegotiate cost or adjust price on volume drivers; investigate premium-priced decliners.",
    })
    recs.append({
        "title": "Close assortment gaps where competitors show demand and we are thin",
        "action": "Assortment gap",
        "why": (f"{S['n_gaps']} competitor demand cells (subcategory × shade) show high popularity or a rising "
                f"trend where we hold ≤1 active SKU. Treat as a supplier follow-up watchlist "
                f"(competitor sample per cell is small — validate before ranging in)."),
        "evidence": gaps[:4],
        "do": "Brief top 3–4 cells to suppliers; range-in or request samples; re-check next signal refresh.",
    })
    return recs


def render_markdown(S, recs, gaps):
    d = date.today().isoformat()
    L = []
    L.append("# Category Opportunity Review — Hair Coloration")
    L.append(f"_Customer: ZenBeauty Retail · Category: Beauty > Hair Coloration · Generated {d}_\n")
    L.append("> Auto-generated by `analyze.py` from the three source CSVs. Every number below traces "
             "to specific rows in `outputs/opportunities.csv` / `outputs/assortment_gaps.csv`.\n")

    L.append("## Headline")
    L.append(f"- The retailer captures only **{S['channel_share_pct']:.1f}%** of wider-market demand in this "
             f"category ({eur(S['channel_rev'])} channel vs {eur(S['market_rev'])} market, 12w) — the core story "
             f"is **execution, not demand**.")
    L.append(f"- Modeled near-term revenue upside from availability + promotion: up to "
             f"**{eur(S['total_revenue_upside'])}**; margin-repair upside up to **{eur(S['upside_margin'])}**.")
    L.append(f"- **{S['delist_n']}** SKUs are delist/markdown candidates, freeing ~**{S['shelf_freed_cm']:.0f} cm** "
             f"of shelf to reallocate.\n")

    L.append("## Where the opportunities sit")
    L.append("| Action | SKUs | Modeled value (12w) |")
    L.append("|---|--:|--:|")
    order = ["Fix availability", "Promote", "Price / margin", "Delist / markdown"]
    for a in order:
        d0 = S["by_action"].get(a, {"n": 0, "value": 0})
        val = eur(d0["value"]) if d0["value"] else "—"
        L.append(f"| {a} | {d0['n']} | {val} |")
    L.append(f"| Assortment gap (cells) | {S['n_gaps']} | watchlist |\n")

    L.append("## Recommendations")
    for i, r in enumerate(recs, 1):
        L.append(f"### {i}. {r['title']}")
        L.append(f"**Why:** {r['why']}\n")
        if r["action"] == "Assortment gap":
            L.append("| Subcategory | Shade | Comp. signal | Comp. trend | Active SKUs | Comp. rows |")
            L.append("|---|---|--:|--:|--:|--:|")
            for g in r["evidence"]:
                L.append(f"| {g['subcategory']} | {g['shade_group']} | {g['competitor_signal_0_100']:.0f} "
                         f"| {g['competitor_trend_12w_pct']*100:+.0f}% | {g['active_skus_held']} | {g['competitor_rows']} |")
        else:
            L.append("| SKU | Product | Evidence | Value (12w) |")
            L.append("|---|---|---|--:|")
            for f in r["evidence"]:
                val = eur(f["opportunity_value_eur"]) if f["opportunity_value_eur"] else "—"
                L.append(f"| {f['product_id']} | {f['product_name']} | {f['rationale']} | {val} |")
        L.append(f"\n**Action:** {r['do']}\n")

    L.append("## Method & caveats")
    L.append("- **Execution gap / modeled value** = `market_revenue × subcategory-median channel share − current "
             "channel revenue`. `market_*` is a demand proxy, so this is a prioritisation ceiling, not a forecast.")
    L.append("- Rules use percentile thresholds computed from the data (see `README.md` → Methodology).")
    L.append("- Competitor price/gap cells can be thin (few competitor rows); `comp_rows` is shown so low-n "
             "signals can be validated before acting.")
    L.append("- Data is synthetic; brand names are illustrative.")
    return "\n".join(L)


HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Category Opportunity Review — Hair Coloration</title>
<script>
  (() => {
    const param = new URLSearchParams(window.location.search).get("clawpilotTheme");
    const theme = param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  })();
</script>
<style>
:root{
  color-scheme:light;
  --cp-bg:#f7f4ef;--cp-bg-elevated:#fcfbf8;--cp-surface:#ffffff;--cp-surface-soft:#f5f5f5;
  --cp-border:#dedede;--cp-border-strong:#919191;--cp-text:#242424;--cp-text-muted:#5c5c5c;
  --cp-text-soft:#6f6f6f;--cp-accent:#b11f4b;--cp-accent-hover:#9a1a41;--cp-accent-soft:rgba(177,31,75,0.08);
  --cp-accent-fg:#ffffff;--cp-success:#16a34a;--cp-danger:#dc2626;--cp-warning:#f59e0b;--cp-link:#0078d4;
  --cp-shadow:0 18px 48px rgba(0,0,0,0.12);--cp-highlight:rgba(177,31,75,0.12);
}
html[data-theme="dark"]{
  color-scheme:dark;
  --cp-bg:#3d3b3a;--cp-bg-elevated:#343231;--cp-surface:#292929;--cp-surface-soft:#2e2e2e;
  --cp-border:#474747;--cp-border-strong:#5f5f5f;--cp-text:#dedede;--cp-text-muted:#919191;
  --cp-text-soft:#b0b0b0;--cp-accent:#fd8ea1;--cp-accent-hover:#fb7b91;--cp-accent-soft:rgba(253,142,161,0.14);
  --cp-accent-fg:#1a1a1a;--cp-success:#4ade80;--cp-danger:#f87171;--cp-warning:#fbbf24;--cp-link:#4da6ff;
  --cp-shadow:0 18px 48px rgba(0,0,0,0.32);--cp-highlight:rgba(253,142,161,0.12);
}
*{box-sizing:border-box}
body{margin:0;background:var(--cp-bg);color:var(--cp-text);
  font-family:"Segoe UI",Aptos,Calibri,-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.45}
.wrap{max-width:1200px;margin:0 auto;padding:28px 22px 64px}
header h1{margin:0 0 4px;font-size:1.6rem}
header p{margin:0;color:var(--cp-text-muted);font-size:.92rem}
.theme-btn{float:right;background:var(--cp-surface);color:var(--cp-text);border:1px solid var(--cp-border);
  border-radius:.625rem;padding:6px 12px;cursor:pointer;font-size:.85rem}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:22px 0}
.kpi{background:var(--cp-surface);border:1px solid var(--cp-border);border-radius:16px;padding:16px 18px;
  box-shadow:0 0 2px rgba(0,0,0,0.12),0 1px 2px rgba(0,0,0,0.14)}
.kpi .v{font-size:1.5rem;font-weight:700}
.kpi .l{color:var(--cp-text-muted);font-size:.8rem;margin-top:2px}
.kpi .s{color:var(--cp-text-soft);font-size:.72rem;margin-top:6px}
h2{font-size:1.15rem;margin:30px 0 12px;border-bottom:1px solid var(--cp-border);padding-bottom:6px}
.recs{display:grid;gap:14px}
.rec{background:var(--cp-surface);border:1px solid var(--cp-border);border-left:4px solid var(--cp-accent);
  border-radius:12px;padding:14px 16px}
.rec h3{margin:0 0 6px;font-size:1.02rem}
.rec .why{color:var(--cp-text-muted);font-size:.9rem;margin-bottom:8px}
.rec .do{font-size:.86rem;margin-top:8px}
.rec ul{margin:6px 0 0;padding-left:18px;font-size:.85rem}
.rec li{margin:3px 0}
.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:8px 0 14px}
.controls input,.controls select{background:var(--cp-surface);color:var(--cp-text);border:1px solid var(--cp-border);
  border-radius:.625rem;padding:8px 10px;font-size:.85rem}
.controls input{flex:1;min-width:200px}
.pill{border:1px solid var(--cp-border);background:var(--cp-surface);color:var(--cp-text-muted);border-radius:999px;
  padding:5px 12px;font-size:.8rem;cursor:pointer;user-select:none}
.pill.active{background:var(--cp-accent);color:var(--cp-accent-fg);border-color:var(--cp-accent)}
.tablewrap{overflow-x:auto;border:1px solid var(--cp-border);border-radius:12px;background:var(--cp-surface)}
table{border-collapse:collapse;width:100%;font-size:.83rem}
th,td{padding:9px 11px;text-align:left;border-bottom:1px solid var(--cp-border);white-space:nowrap}
th{background:var(--cp-surface-soft);cursor:pointer;position:sticky;top:0;font-weight:600}
td.num,th.num{text-align:right}
tr:hover td{background:var(--cp-accent-soft)}
.tag{font-size:.72rem;padding:2px 8px;border-radius:999px;border:1px solid var(--cp-border);color:var(--cp-text)}
.tag.avail{background:rgba(245,158,11,.14);border-color:var(--cp-warning)}
.tag.promo{background:rgba(22,163,74,.14);border-color:var(--cp-success)}
.tag.delist{background:rgba(220,38,38,.12);border-color:var(--cp-danger)}
.tag.price{background:var(--cp-accent-soft);border-color:var(--cp-accent)}
.bar{height:6px;border-radius:999px;background:var(--cp-surface-soft);position:relative;min-width:60px}
.bar>span{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:var(--cp-accent)}
.muted{color:var(--cp-text-soft)}
.count{color:var(--cp-text-muted);font-size:.82rem;margin-left:auto}
footer{margin-top:34px;color:var(--cp-text-soft);font-size:.78rem}
a{color:var(--cp-link)}
</style>
</head>
<body>
<div class="wrap">
<header>
  <button class="theme-btn" onclick="toggleTheme()">◐ theme</button>
  <h1>Category Opportunity Review — Hair Coloration</h1>
  <p>ZenBeauty Retail · Beauty &gt; Hair Coloration · generated <span id="gen"></span> · <span id="nsku"></span> SKUs analysed</p>
</header>

<div class="kpis" id="kpis"></div>

<h2>Top recommendations</h2>
<div class="recs" id="recs"></div>

<h2>Opportunity explorer</h2>
<div class="controls">
  <div id="pills"></div>
</div>
<div class="controls">
  <input id="q" placeholder="Search product, brand, subcategory…" oninput="render()"/>
  <select id="subcat" onchange="render()"></select>
  <span class="count" id="count"></span>
</div>
<div class="tablewrap">
  <table id="tbl">
    <thead><tr>
      <th data-k="product_id">SKU</th>
      <th data-k="product_name">Product</th>
      <th data-k="primary_action">Action</th>
      <th data-k="subcategory">Subcategory</th>
      <th class="num" data-k="opportunity_value_eur">Value €</th>
      <th class="num" data-k="priority_score">Priority</th>
      <th class="num" data-k="channel_revenue_eur_12w">Channel €</th>
      <th class="num" data-k="market_revenue_eur_12w">Market €</th>
      <th class="num" data-k="channel_share_pct">Share %</th>
      <th class="num" data-k="channel_margin_pct">Margin</th>
      <th>Evidence</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>
</div>

<h2>Assortment gap watchlist</h2>
<div class="tablewrap">
  <table>
    <thead><tr>
      <th>Subcategory</th><th>Shade</th><th class="num">Comp. signal</th>
      <th class="num">Comp. trend</th><th class="num">Active SKUs</th><th class="num">Comp. rows</th>
    </tr></thead>
    <tbody id="gaprows"></tbody>
  </table>
</div>

<footer>
  Modeled value = market revenue × subcategory-median channel share − current channel revenue (a prioritisation
  ceiling, not a forecast). Data is synthetic; brand names illustrative. Source of truth:
  <code>outputs/opportunities.csv</code>, <code>outputs/assortment_gaps.csv</code>.
</footer>
</div>

<script>
const DATA = __DATA__;
const TAGCLS = {"Fix availability":"avail","Promote":"promo","Delist / markdown":"delist","Price / margin":"price"};
let activeAction = "All", sortK = "opportunity_value_eur", sortDir = -1;

function fmtEur(v){return v ? "€"+Math.round(v).toLocaleString() : "—";}
function pct(v){return (v*100).toFixed(0)+"%";}

function kpis(){
  const s = DATA.summary;
  const cards = [
    ["Channel share of market", s.channel_share_pct.toFixed(1)+"%", fmtEur(s.channel_rev)+" of "+fmtEur(s.market_rev), "execution headroom"],
    ["Revenue upside (12w)", fmtEur(s.total_revenue_upside), "availability + promotion", "modeled ceiling"],
    ["Margin-repair upside", fmtEur(s.upside_margin), "thin-margin volume sellers", ""],
    ["Delist candidates", s.delist_n, "~"+Math.round(s.shelf_freed_cm)+" cm shelf freed", ""],
    ["Assortment gaps", s.n_gaps, "competitor demand cells", "supplier follow-up"],
  ];
  document.getElementById("kpis").innerHTML = cards.map(c=>
    `<div class="kpi"><div class="v">${c[1]}</div><div class="l">${c[0]}</div><div class="s">${c[2]}${c[3]?" · "+c[3]:""}</div></div>`).join("");
}

function recs(){
  document.getElementById("recs").innerHTML = DATA.recommendations.map((r,i)=>{
    let ev="";
    if(r.action==="Assortment gap"){
      ev = "<ul>"+r.evidence.map(g=>`<li><b>${g.subcategory} · ${g.shade_group}</b> — signal ${g.competitor_signal_0_100.toFixed(0)}, trend ${(g.competitor_trend_12w_pct*100).toFixed(0)}%, ${g.active_skus_held} active SKU(s)</li>`).join("")+"</ul>";
    } else {
      ev = "<ul>"+r.evidence.map(f=>`<li><b>${f.product_id}</b> ${f.product_name} — ${f.rationale}${f.opportunity_value_eur?" ("+fmtEur(f.opportunity_value_eur)+")":""}</li>`).join("")+"</ul>";
    }
    return `<div class="rec"><h3>${i+1}. ${r.title}</h3><div class="why">${r.why}</div>${ev}<div class="do">→ <b>Action:</b> ${r.do}</div></div>`;
  }).join("");
}

function setup(){
  document.getElementById("gen").textContent = DATA.generated;
  document.getElementById("nsku").textContent = DATA.summary.n_skus;
  const actions = ["All", ...Object.keys(TAGCLS)];
  document.getElementById("pills").innerHTML = actions.map(a=>
    `<span class="pill${a===activeAction?' active':''}" onclick="setAction('${a}')">${a}</span>`).join(" ");
  const subs = ["All subcategories", ...[...new Set(DATA.opportunities.map(o=>o.subcategory))].sort()];
  document.getElementById("subcat").innerHTML = subs.map(s=>`<option>${s}</option>`).join("");
  document.querySelectorAll("th[data-k]").forEach(th=>th.onclick=()=>{
    const k=th.dataset.k; sortDir = (sortK===k)?-sortDir:-1; sortK=k; render();
  });
  document.getElementById("gaprows").innerHTML = DATA.assortment_gaps.map(g=>
    `<tr><td>${g.subcategory}</td><td>${g.shade_group}</td><td class="num">${g.competitor_signal_0_100.toFixed(0)}</td>
     <td class="num">${(g.competitor_trend_12w_pct*100).toFixed(0)}%</td><td class="num">${g.active_skus_held}</td>
     <td class="num">${g.competitor_rows}</td></tr>`).join("");
  kpis(); recs(); render();
}

function setAction(a){activeAction=a;document.querySelectorAll('.pill').forEach(p=>p.classList.toggle('active',p.textContent===a));render();}
function toggleTheme(){const h=document.documentElement;h.setAttribute('data-theme',h.getAttribute('data-theme')==='dark'?'light':'dark');}

function render(){
  const q = document.getElementById("q").value.toLowerCase();
  const sc = document.getElementById("subcat").value;
  let rows = DATA.opportunities.filter(o=>{
    if(activeAction!=="All" && o.primary_action!==activeAction) return false;
    if(sc && !sc.startsWith("All") && o.subcategory!==sc) return false;
    if(q && !(o.product_name+" "+o.brand+" "+o.subcategory+" "+o.product_id).toLowerCase().includes(q)) return false;
    return true;
  });
  rows.sort((a,b)=>{let x=a[sortK],y=b[sortK];if(typeof x==="string"){x=x||"";y=y||"";return sortDir*x.localeCompare(y);}return sortDir*((x||0)-(y||0));});
  const maxv = Math.max(...DATA.opportunities.map(o=>o.opportunity_value_eur),1);
  document.getElementById("rows").innerHTML = rows.map(o=>{
    const cls = TAGCLS[o.primary_action]||"";
    return `<tr>
      <td>${o.product_id}</td>
      <td>${o.product_name}<div class="muted">${o.brand}${o.private_label?" · PL":""}</div></td>
      <td><span class="tag ${cls}">${o.primary_action}</span></td>
      <td>${o.subcategory}</td>
      <td class="num">${fmtEur(o.opportunity_value_eur)}</td>
      <td class="num"><div class="bar"><span style="width:${Math.round(100*o.opportunity_value_eur/maxv)}%"></span></div></td>
      <td class="num">${fmtEur(o.channel_revenue_eur_12w)}</td>
      <td class="num">${fmtEur(o.market_revenue_eur_12w)}</td>
      <td class="num">${o.channel_share_pct.toFixed(1)}%</td>
      <td class="num">${pct(o.channel_margin_pct)}</td>
      <td class="muted">${o.rationale}</td>
    </tr>`;
  }).join("");
  document.getElementById("count").textContent = rows.length+" of "+DATA.opportunities.length+" flagged SKUs";
}
setup();
</script>
</body>
</html>
"""


def render_dashboard(payload):
    return HTML_TEMPLATE.replace("__DATA__", json.dumps(payload, ensure_ascii=False))


# Root landing page so the GitHub Pages URL opens the dashboard directly.
INDEX_REDIRECT = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta http-equiv="refresh" content="0; url=outputs/dashboard.html"/>
<link rel="canonical" href="outputs/dashboard.html"/>
<title>Category Opportunity Review — Hair Coloration</title>
</head>
<body style="font-family:Segoe UI,Calibri,sans-serif;padding:2rem">
Redirecting to the <a href="outputs/dashboard.html">Category Opportunity Review dashboard</a>…
</body>
</html>
"""


# ------------------------------------------ Main --------------------------------------
def main():
    os.makedirs(OUT, exist_ok=True)
    sku, comp = load()
    bench = competitor_benchmarks(comp)
    flagged, T, share_med = classify(sku, bench)
    gaps = assortment_gaps(sku, bench)
    S = build_summary(sku, flagged, gaps)
    recs = recommendations(flagged, gaps, S)

    opp_fields = ["product_id", "product_name", "brand", "subcategory", "shade_group", "supplier",
                  "private_label", "status", "stock_status", "primary_action", "opportunity_value_eur",
                  "priority_score", "rationale", "also_flagged", "price_eur", "comp_benchmark_price_eur",
                  "price_index", "channel_revenue_eur_12w", "channel_units_12w", "channel_margin_pct",
                  "channel_trend_12w_pct", "market_revenue_eur_12w", "market_trend_12w_pct",
                  "channel_share_pct", "modeled_potential_eur", "shelf_space_cm"]
    gap_fields = ["subcategory", "shade_group", "gap_score", "competitor_signal_0_100",
                  "competitor_trend_12w_pct", "competitor_rows", "active_skus_held", "channel_revenue_eur_12w"]

    write_csv(os.path.join(OUT, "opportunities.csv"), flagged, opp_fields)
    write_csv(os.path.join(OUT, "assortment_gaps.csv"), gaps, gap_fields)

    with open(os.path.join(OUT, "category_review.md"), "w", encoding="utf-8") as f:
        f.write(render_markdown(S, recs, gaps))

    payload = {
        "generated": date.today().isoformat(),
        "summary": {k: S[k] for k in ("n_skus", "channel_rev", "market_rev", "channel_share_pct",
                                       "total_revenue_upside", "upside_availability", "upside_promote",
                                       "upside_margin", "delist_n", "shelf_freed_cm", "n_gaps")},
        "recommendations": recs,
        "opportunities": flagged,
        "assortment_gaps": gaps,
    }
    with open(os.path.join(OUT, "dashboard.html"), "w", encoding="utf-8") as f:
        f.write(render_dashboard(payload))

    # site entry point for GitHub Pages (root URL -> dashboard)
    with open(os.path.join(BASE, "index.html"), "w", encoding="utf-8") as f:
        f.write(INDEX_REDIRECT)

    # console handoff
    print("Category Opportunity Review — pipeline complete\n" + "-" * 48)
    print(f"SKUs analysed        : {S['n_skus']}")
    print(f"Channel share of mkt : {S['channel_share_pct']:.1f}%  ({eur(S['channel_rev'])} / {eur(S['market_rev'])})")
    print(f"Flagged SKUs         : {len(flagged)}")
    for a in ["Fix availability", "Promote", "Price / margin", "Delist / markdown"]:
        d0 = S["by_action"].get(a, {"n": 0, "value": 0})
        print(f"  - {a:<18}: {d0['n']:>3}  value {eur(d0['value'])}")
    print(f"Assortment gaps      : {S['n_gaps']} cells")
    print(f"Revenue upside (12w) : up to {eur(S['total_revenue_upside'])}  | margin repair up to {eur(S['upside_margin'])}")
    print(f"Shelf freed (delist) : ~{S['shelf_freed_cm']:.0f} cm")
    print("\nOutputs written to ./outputs :")
    print("  opportunities.csv, assortment_gaps.csv, category_review.md, dashboard.html")
    print("Site entry point    : ./index.html (redirects to the dashboard for GitHub Pages)")


if __name__ == "__main__":
    main()
