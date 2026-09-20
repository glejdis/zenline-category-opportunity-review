#!/usr/bin/env python3
"""Build an auditable, decision-focused category review using only the standard library."""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import math
import os
import re
from collections import Counter
from datetime import date
from pathlib import Path
from xml.etree import ElementTree

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "outputs")
INPUT_FILES = (
    "sku_performance.csv",
    "product_metadata.csv",
    "competitor_market_signals.csv",
)
RULE_VERSION = "decision-review-2"
CFG = {
    "mkt_rev_strong_pctl": 0.66,
    "chan_rev_low_pctl": 0.25,
    "margin_low_pctl": 0.20,
    "volume_seller_pctl": 0.60,
    "promote_min_mkt_trend": 0.05,
    "price_index_flag": 1.15,
    "gap_signal_min": 60.0,
    "gap_trend_min": 0.25,
    "gap_max_active_cover": 1,
    "competitor_refresh_days": 60,
}

SKU_FIELDS = {
    "product_id", "product_name", "brand", "category", "subcategory", "shade_group",
    "seasonality", "status", "stock_status", "private_label", "price_eur", "pack_size",
    "attributes", "channel_revenue_eur_12w", "channel_units_sold_12w",
    "channel_margin_pct", "channel_sales_trend_12w_pct", "market_revenue_eur_12w",
    "market_units_sold_12w", "market_sales_trend_12w_pct",
}
META_FIELDS = {
    "product_id", "product_name", "brand", "category", "subcategory", "price_eur",
    "pack_size", "private_label", "shade_group", "seasonality", "attributes",
    "launch_season", "shelf_space_cm", "supplier", "ean",
}
COMP_FIELDS = {
    "competitor_product_id", "competitor_product_name", "brand", "category",
    "subcategory", "shade_group", "price_eur", "rank_or_popularity_signal",
    "signal_score_0_100", "source", "trend_score_12w_pct", "observed_date",
}

ACTION_DETAILS = {
    "Fix availability": {
        "order": 0, "tier": "Now", "verb": "Check supply for",
        "owner": "Supply planner",
        "step": "Confirm physical and online availability, stock-feed accuracy and supplier lead time; replenish if feasible before considering promotion.",
        "measure": "Availability, units sold and gross profit after the supply check.",
    },
    "Investigate zero sales": {
        "order": 2, "tier": "Now", "verb": "Investigate zero sales for",
        "owner": "E-commerce / category operations",
        "step": "Check listing visibility, barcode mapping, distribution and sales-feed completeness. Check the selling season before allocating promotional spend.",
        "measure": "Validated listing and sales feed; first confirmed sales, units and gross profit.",
    },
    "Review reactivation": {
        "order": 3, "tier": "Validate first", "verb": "Review reactivation of",
        "owner": "Category manager",
        "step": "Establish why the item is inactive and whether the demand signal is relevant. Check supply, product role and commercial terms before a reactivation trial.",
        "measure": "Documented range decision; if trialled, units and gross profit against an agreed baseline.",
    },
    "Review margin": {
        "order": 4, "tier": "Next", "verb": "Review margin on",
        "owner": "Buyer / commercial finance",
        "step": "Validate cost and margin definitions and discuss supplier terms. Assess volume risk before any price change; the peer median is not a price target.",
        "measure": "Gross profit and units sold, not margin percentage alone.",
    },
    "Test promotion": {
        "order": 5, "tier": "Next", "verb": "Test merchandising for",
        "owner": "Category / merchandising manager",
        "step": "Verify availability, product visibility and promotional economics. Run a small, time-bounded merchandising test with a baseline or control.",
        "measure": "Incremental units and gross profit net of promotional costs and cannibalisation.",
    },
    "Review price benchmark": {
        "order": 6, "tier": "Validate first", "verb": "Validate price comparators for",
        "owner": "Buyer / pricing analyst",
        "step": "Refresh the observations and match product form, pack size and positioning before drawing a pricing conclusion. Do not automatically cut price.",
        "measure": "Verified like-for-like comparators and an approved pricing hypothesis.",
    },
    "Review seasonal range": {
        "order": 7, "tier": "Validate first", "verb": "Review the selling season for",
        "owner": "Category manager",
        "step": "Confirm the performance-window dates and seasonal selling plan before deciding whether to retain, reposition or clear the product.",
        "measure": "A documented seasonal range decision rather than an automatic exit.",
    },
    "Review delist / markdown": {
        "order": 8, "tier": "Validate first", "verb": "Review the range role of",
        "owner": "Category manager",
        "step": "Check product role, distribution and residual stock. Consider exit only after validation; consider markdown only if stock and clearance economics justify it.",
        "measure": "Category gross profit and customer coverage after any approved range change.",
    },
    "Confirm exit": {
        "order": 9, "tier": "Validate first", "verb": "Confirm the inactive range decision for",
        "owner": "Category manager",
        "step": "Confirm why the product is inactive, its seasonal role and any remaining physical stock or shelf allocation. Inactive status alone does not justify markdown.",
        "measure": "Documented exit or retain decision; any clearance based on verified residual units.",
    },
}

METHODOLOGY = {
    "selection": (
        "Operational checks come first, then lifecycle validation and commercial tests. "
        "Select up to five concrete items, taking the first item per primary action before "
        "adding repeats only when fewer than three decisions are available. No empty cards "
        "or mandatory one-per-lever recommendations."
    ),
    "scenario": (
        "Revenue scenarios are distances to a subcategory peer ratio; gross-profit scenarios "
        "hold current revenue constant and change margin to a peer median. Neither is a forecast, "
        "guaranteed gain or statistical upper bound. Do not add revenue to gross profit. "
        "No annualisation; promotion cost, elasticity and cannibalisation are not modelled."
    ),
    "evidence": (
        "Snapshot only = direct fields support an investigation, not a causal conclusion. "
        "Needs context = lifecycle, zero-sales or seasonal reasons are unknown. "
        "Limited comparison = category/shade matches with unverified product comparability. "
        "These labels describe evidence, not probability of success."
    ),
}


def to_float(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"Expected a finite number, received {value!r}")
    return number


def to_int(value):
    number = to_float(value)
    if not number.is_integer():
        raise ValueError(f"Expected whole units, received {value!r}")
    return int(number)


def to_bool(value):
    normalised = str(value).strip().lower()
    if normalised not in {"true", "false", "1", "0", "yes", "no"}:
        raise ValueError(f"Expected a boolean, received {value!r}")
    return normalised in {"true", "1", "yes"}


def percentile(values, q):
    """Linear interpolation, with an explicit missing result for an empty cohort."""
    if not 0 <= q <= 1:
        raise ValueError("Percentile must lie between 0 and 1")
    xs = sorted(values)
    if not xs:
        return None
    position = q * (len(xs) - 1)
    lower = int(position)
    fraction = position - lower
    return xs[lower] + fraction * (xs[min(lower + 1, len(xs) - 1)] - xs[lower])


def median(values):
    return percentile(values, 0.5)


def eur(value):
    return "Not estimated" if value is None else f"€{value:,.2f}"


def read_csv(path, required_fields=None):
    with open(path, newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        missing = (required_fields or set()) - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"{Path(path).name}: missing columns: {', '.join(sorted(missing))}")
        rows = []
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"{Path(path).name}:{reader.line_num}: malformed CSV row")
            row["_source_row"] = reader.line_num
            rows.append(row)
        return rows


def _validate_ids(rows, key, filename):
    seen = set()
    for row in rows:
        identifier = row[key].strip()
        if not identifier or identifier in seen:
            raise ValueError(f"{filename}:{row['_source_row']}: empty or duplicate {key}: {identifier!r}")
        seen.add(identifier)


def _number(row, field, filename, minimum=None, maximum=None, integer=False):
    try:
        value = to_int(row[field]) if integer else to_float(row[field])
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{filename}:{row['_source_row']}: invalid {field}: {row[field]!r}") from exc
    if (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
        raise ValueError(f"{filename}:{row['_source_row']}: out-of-range {field}: {value}")
    row[field] = value


def load(base=BASE):
    sku = read_csv(Path(base) / INPUT_FILES[0], SKU_FIELDS)
    meta = read_csv(Path(base) / INPUT_FILES[1], META_FIELDS)
    comp = read_csv(Path(base) / INPUT_FILES[2], COMP_FIELDS)
    for rows, key, filename in (
        (sku, "product_id", INPUT_FILES[0]),
        (meta, "product_id", INPUT_FILES[1]),
        (comp, "competitor_product_id", INPUT_FILES[2]),
    ):
        _validate_ids(rows, key, filename)
    if not sku:
        raise ValueError("sku_performance.csv: no products to review")
    meta_by_id = {row["product_id"]: row for row in meta}
    missing_meta = sorted({row["product_id"] for row in sku} - set(meta_by_id))
    if missing_meta:
        raise ValueError(f"product_metadata.csv: missing product IDs: {', '.join(missing_meta)}")
    for row in meta:
        _number(row, "shelf_space_cm", INPUT_FILES[1], minimum=0)
        _number(row, "price_eur", INPUT_FILES[1], minimum=0)
        if not row["supplier"].strip():
            raise ValueError(f"product_metadata.csv:{row['_source_row']}: missing supplier")
    for row in sku:
        for field in ("price_eur", "channel_revenue_eur_12w", "market_revenue_eur_12w"):
            _number(row, field, INPUT_FILES[0], minimum=0)
        for field in ("channel_units_sold_12w", "market_units_sold_12w"):
            _number(row, field, INPUT_FILES[0], minimum=0, integer=True)
        _number(row, "channel_margin_pct", INPUT_FILES[0], minimum=0, maximum=1)
        for field in ("channel_sales_trend_12w_pct", "market_sales_trend_12w_pct"):
            _number(row, field, INPUT_FILES[0], minimum=-1)
        for field in ("product_name", "brand", "category", "subcategory", "shade_group", "pack_size"):
            if not row[field].strip():
                raise ValueError(f"sku_performance.csv:{row['_source_row']}: missing {field}")
        if row["status"] not in {"aktiv", "inaktiv"}:
            raise ValueError(f"sku_performance.csv:{row['_source_row']}: unknown status")
        if row["stock_status"] not in {"in_stock", "low_stock", "out_of_stock"}:
            raise ValueError(f"sku_performance.csv:{row['_source_row']}: unknown stock_status")
        if row["seasonality"] not in {"Evergreen", "Summer", "Winter"}:
            raise ValueError(f"sku_performance.csv:{row['_source_row']}: unknown seasonality")
        try:
            row["private_label"] = to_bool(row["private_label"])
        except ValueError as exc:
            raise ValueError(f"sku_performance.csv:{row['_source_row']}: invalid private_label") from exc
        metadata = meta_by_id[row["product_id"]]
        row.update({
            "supplier": metadata["supplier"],
            "shelf_space_cm": metadata["shelf_space_cm"],
            "launch_season": metadata["launch_season"],
            "ean": metadata["ean"],
            "_metadata_row": metadata["_source_row"],
            "chan_share": (
                row["channel_revenue_eur_12w"] / row["market_revenue_eur_12w"]
                if row["market_revenue_eur_12w"] > 0 else None
            ),
        })
    for row in comp:
        for field in ("competitor_product_name", "brand", "subcategory", "shade_group", "source"):
            if not row[field].strip():
                raise ValueError(f"competitor_market_signals.csv:{row['_source_row']}: missing {field}")
        for field in ("price_eur", "rank_or_popularity_signal"):
            _number(row, field, INPUT_FILES[2], minimum=0)
        _number(row, "signal_score_0_100", INPUT_FILES[2])
        _number(row, "trend_score_12w_pct", INPUT_FILES[2], minimum=-1)
        try:
            date.fromisoformat(row["observed_date"])
        except ValueError as exc:
            raise ValueError(
                f"competitor_market_signals.csv:{row['_source_row']}: invalid observed_date"
            ) from exc
    return sku, comp


def valid_signal(row):
    return 0 <= row["signal_score_0_100"] <= 100


def competitor_example(row):
    return {
        "record_id": row.get("competitor_product_id", "Not supplied"),
        "name": row.get("competitor_product_name", "Not supplied"),
        "brand": row.get("brand", "Not supplied"),
        "price_eur": row["price_eur"],
        "source": row.get("source", "Not supplied"),
        "observed_date": row.get("observed_date"),
        "signal_score_0_100": row["signal_score_0_100"],
        "signal_valid": valid_signal(row),
        "trend_score_12w_pct": row["trend_score_12w_pct"],
    }


def competitor_benchmarks(comp):
    cells = {}
    for row in comp:
        cells.setdefault((row["subcategory"], row["shade_group"]), []).append(row)
    benchmarks = {}
    for key, rows in sorted(cells.items()):
        scores = [row["signal_score_0_100"] for row in rows if valid_signal(row)]
        benchmarks[key] = {
            "comp_med_price": median([row["price_eur"] for row in rows if row["price_eur"] > 0]),
            "comp_signal": sum(scores) / len(scores) if scores else None,
            "comp_trend": sum(row["trend_score_12w_pct"] for row in rows) / len(rows),
            "comp_n": len(rows),
            "valid_signal_rows": len(scores),
            "rows": sorted(rows, key=lambda row: row.get("competitor_product_id", "")),
        }
    return benchmarks


def data_quality(sku, comp, as_of):
    observations = [date.fromisoformat(row["observed_date"]) for row in comp]
    exclusions = [
        {
            "file": INPUT_FILES[2], "record_id": row["competitor_product_id"],
            "row_number": row.get("_source_row"), "field": "signal_score_0_100",
            "value": row["signal_score_0_100"],
            "reason": "Outside 0-100; excluded from popularity averages and popularity ranking. Price and trend retained as separate, unverified observations.",
        }
        for row in comp if not valid_signal(row)
    ]
    warnings = [
        "Synthetic dataset: product names, classifications and suppliers need validation before real commercial use.",
        "The performance window is 12 weeks, but its end date and the date of the stock snapshot are not supplied.",
        "Market revenue is a demand proxy. Channel / market is a descriptive ratio, not verified market share or proof of poor execution.",
    ]
    if exclusions:
        warnings.append(
            f"{len(exclusions)} popularity scores are outside 0-100 and excluded from popularity calculations; raw values remain visible."
        )
    if observations:
        oldest_age = (as_of - min(observations)).days
        if oldest_age > CFG["competitor_refresh_days"]:
            warnings.append(
                f"Oldest competitor observations are {oldest_age} days old as of {as_of.isoformat()}. "
                f"The {CFG['competitor_refresh_days']}-day refresh threshold is an explicit review assumption, not a freshness guarantee."
            )
        if max(observations) > as_of:
            warnings.append("Some competitor observations are later than the review date; validate the snapshot before using them.")
    else:
        warnings.append("No competitor observations are supplied; external price and assortment evidence is unavailable.")
    inconsistent = [
        row["product_id"] for row in sku
        if (row["channel_revenue_eur_12w"] == 0) != (row["channel_units_sold_12w"] == 0)
    ]
    if inconsistent:
        warnings.append(f"Revenue/units zero-state mismatch; validate the sales feed for: {', '.join(inconsistent)}.")
    return {
        "competitor_observed_from": min(observations).isoformat() if observations else None,
        "competitor_observed_to": max(observations).isoformat() if observations else None,
        "competitor_age_days": (as_of - max(observations)).days if observations else None,
        "invalid_signal_count": len(exclusions),
        "warnings": warnings,
        "exclusions": exclusions,
    }


def _scenario(value=None, value_type="Not estimated", formula="No defensible monetary estimate from the supplied data.", assumptions=None):
    return {
        "value_eur": round(value, 2) if value is not None else None,
        "value_type": value_type,
        "period": "12 weeks",
        "formula": formula,
        "assumptions": assumptions or [
            "An investigation is recommended; financial impact is not established.",
        ],
    }


def _source_ref(filename, row, key="product_id"):
    return {"file": filename, "record_id": row.get(key, "Not supplied"), "row_number": row.get("_source_row")}


def _comparison_caveats(benchmark, as_of):
    caveats = [
        "Matching subcategory and shade does not establish like-for-like pricing or substitutability; competitor pack size and product form are not verified.",
        "Competitor rows are observations, not necessarily independent corroboration. Refresh sources before a commercial decision.",
    ]
    if benchmark["comp_n"] == 1:
        caveats.append("Only one competitor observation supports this comparison.")
    if benchmark["valid_signal_rows"] < benchmark["comp_n"]:
        caveats.append("Invalid popularity scores are excluded, not capped or silently corrected.")
    dates = [
        date.fromisoformat(row["observed_date"])
        for row in benchmark["rows"] if row.get("observed_date")
    ]
    if dates and (as_of - min(dates)).days > CFG["competitor_refresh_days"]:
        caveats.append(f"Competitor evidence is older than the {CFG['competitor_refresh_days']}-day review threshold.")
    return caveats


def classify(sku, bench, as_of=None):
    as_of = as_of or date.today()
    if not sku:
        return [], {}, None
    active = [row for row in sku if row["status"] == "aktiv"]
    population = active or sku
    thresholds = {
        "mkt_rev_strong": percentile([row["market_revenue_eur_12w"] for row in population], CFG["mkt_rev_strong_pctl"]),
        "chan_rev_low": percentile([row["channel_revenue_eur_12w"] for row in population], CFG["chan_rev_low_pctl"]),
        "margin_low": percentile([row["channel_margin_pct"] for row in population], CFG["margin_low_pctl"]),
        "volume_seller": percentile([row["channel_revenue_eur_12w"] for row in population], CFG["volume_seller_pctl"]),
    }
    sellers = [
        row for row in active if row["stock_status"] == "in_stock"
        and row["market_revenue_eur_12w"] > 0
        and row["channel_revenue_eur_12w"] > 0 and row["channel_units_sold_12w"] > 0
    ]
    overall_ratio = median([row["channel_revenue_eur_12w"] / row["market_revenue_eur_12w"] for row in sellers])
    flagged = []
    for row in sku:
        peers = [
            peer for peer in sellers
            if peer["subcategory"] == row["subcategory"] and peer["product_id"] != row["product_id"]
        ]
        peer_ratio = median([peer["channel_revenue_eur_12w"] / peer["market_revenue_eur_12w"] for peer in peers])
        peer_margin = median([peer["channel_margin_pct"] for peer in peers])
        revenue = row["channel_revenue_eur_12w"]
        market = row["market_revenue_eur_12w"]
        ratio = revenue / market if market > 0 else None
        benchmark = bench.get((row["subcategory"], row["shade_group"]))
        comp_price = benchmark["comp_med_price"] if benchmark else None
        price_index = row["price_eur"] / comp_price if comp_price else None
        revenue_scenario = _scenario()
        if peer_ratio is not None and market > 0:
            distance = max(0.0, market * peer_ratio - revenue)
            revenue_scenario = _scenario(
                distance, "Revenue",
                f"max(0, {eur(market)} x {peer_ratio:.16g} - {eur(revenue)}) = {eur(distance)}",
                [
                    f"Benchmark: median channel / market-demand-proxy ratio of {len(peers)} other active, in-stock, selling SKUs in this subcategory.",
                    "Assumes the peer ratio is a relevant comparison; it does not prove stock or promotion caused the distance.",
                    "Snapshot benchmark distance, not forecast, guaranteed gain or upper bound; stock duration and distribution coverage are unknown.",
                    "No annualisation, elasticity, promotional cost or cannibalisation is modelled.",
                ],
            )
        candidates = []

        def add(action, rationale, scenario=None, order=None):
            details = ACTION_DETAILS[action]
            candidates.append({
                "action": action, "rationale": rationale,
                "scenario": scenario if scenario is not None else _scenario(),
                "order": details["order"] if order is None else order,
            })

        growing = market > 0 and row["market_sales_trend_12w_pct"] > 0
        if row["status"] == "inaktiv":
            if growing:
                add("Review reactivation",
                    f"Inactive, but the market-demand proxy is {eur(market)} and growing {row['market_sales_trend_12w_pct']:+.1%}. The reason for inactivity is not supplied.")
            else:
                add("Confirm exit",
                    f"Inactive assortment status; channel revenue {eur(revenue)}, market trend {row['market_sales_trend_12w_pct']:+.1%}. Status is not evidence of residual stock or a failed product.")
        else:
            if row["stock_status"] in {"out_of_stock", "low_stock"} and growing:
                state = row["stock_status"].replace("_", " ")
                add("Fix availability",
                    f"Active and {state}; market-demand proxy {eur(market)}, trend {row['market_sales_trend_12w_pct']:+.1%}. Stock duration and lost sales are unknown.",
                    revenue_scenario, order=0 if row["stock_status"] == "out_of_stock" else 1)
            zero_sales = revenue == 0 or row["channel_units_sold_12w"] == 0
            if row["stock_status"] == "in_stock" and zero_sales and growing:
                add("Investigate zero sales",
                    f"Active and in stock, with {eur(revenue)} channel revenue and {row['channel_units_sold_12w']} units. Market-demand proxy {eur(market)}, trend {row['market_sales_trend_12w_pct']:+.1%}. This exception does not require top-third demand.")
            if (
                row["stock_status"] == "in_stock" and not zero_sales
                and market >= thresholds["mkt_rev_strong"]
                and row["market_sales_trend_12w_pct"] > CFG["promote_min_mkt_trend"]
                and peer_ratio is not None and ratio is not None and ratio < peer_ratio
            ):
                add("Test promotion",
                    f"In stock, with demand proxy {eur(market)} above the {eur(thresholds['mkt_rev_strong'])} threshold and growing {row['market_sales_trend_12w_pct']:+.1%}. Channel / proxy ratio {ratio:.2%} is below the {peer_ratio:.2%} subcategory peer median.",
                    revenue_scenario)
            if (
                row["stock_status"] == "in_stock" and revenue <= thresholds["chan_rev_low"]
                and row["market_sales_trend_12w_pct"] < 0 and row["channel_sales_trend_12w_pct"] <= 0
            ):
                action = "Review delist / markdown" if row["seasonality"] == "Evergreen" else "Review seasonal range"
                add(action,
                    f"Channel revenue {eur(revenue)} is below the {eur(thresholds['chan_rev_low'])} threshold; channel trend {row['channel_sales_trend_12w_pct']:+.1%}, market trend {row['market_sales_trend_12w_pct']:+.1%}. Review product role before changing the range.")
            if (
                revenue > 0 and row["channel_margin_pct"] <= thresholds["margin_low"]
                and revenue >= thresholds["volume_seller"]
                and (peer_margin is None or row["channel_margin_pct"] < peer_margin)
            ):
                margin_scenario = _scenario()
                if peer_margin is not None:
                    uplift = max(0.0, revenue * (peer_margin - row["channel_margin_pct"]))
                    margin_scenario = _scenario(
                        uplift, "Gross profit",
                        f"max(0, {eur(revenue)} x ({peer_margin:.16g} - {row['channel_margin_pct']:.16g})) = {eur(uplift)}",
                        [
                            f"Benchmark: margin median of {len(peers)} other active, in-stock, selling SKUs in the subcategory.",
                            "Holds current revenue constant; changing price may alter demand. A peer margin is not an achievable supplier concession.",
                            "Additional gross profit, not additional revenue or net profit; costs of implementing the action are not supplied.",
                        ],
                    )
                add("Review margin",
                    f"Margin {row['channel_margin_pct']:.1%} is at or below the {thresholds['margin_low']:.1%} threshold on {eur(revenue)} channel revenue. Validate cost and commercial terms.",
                    margin_scenario)
            if price_index is not None and price_index > CFG["price_index_flag"] and row["channel_sales_trend_12w_pct"] < 0:
                add("Review price benchmark",
                    f"Price {eur(row['price_eur'])} is {price_index:.2f}x the {eur(comp_price)} category/shade comparator median while channel trend is {row['channel_sales_trend_12w_pct']:+.1%}. Like-for-like comparability is unverified.")
        if not candidates:
            continue

        candidates.sort(key=lambda candidate: candidate["order"])
        primary = candidates[0]
        action = primary["action"]
        details = ACTION_DETAILS[action]
        context_actions = {
            "Investigate zero sales", "Review reactivation", "Confirm exit",
            "Review seasonal range", "Review delist / markdown",
        }
        evidence_strength = (
            "Limited comparison" if action == "Review price benchmark"
            else "Needs context" if action in context_actions else "Snapshot only"
        )
        caveats = [
            "One 12-week aggregate and current status/stock fields; the period end and stock duration are not supplied.",
            "Market revenue is a demand proxy, not a verified addressable sales pool.",
        ]
        if row["seasonality"] != "Evergreen":
            caveats.append(f"{row['seasonality']} item: verify the selling calendar before promotion, reactivation or clearance; the performance-window end is unknown.")
        supply_context = (
            row["status"] == "aktiv" and row["stock_status"] != "in_stock"
            and action != "Fix availability"
        )
        if supply_context:
            caveats.append(
                f"Current stock is {row['stock_status'].replace('_', ' ')}. Verify supply before assuming the historical sales volume can continue."
            )
        if peer_ratio is None:
            caveats.append("No other comparable active, in-stock sellers; no peer-based revenue scenario is estimated.")
        elif len(peers) < 3:
            caveats.append(f"Small peer group ({len(peers)} SKUs); the benchmark may be unstable.")
        if benchmark and any(candidate["action"] == "Review price benchmark" for candidate in candidates):
            caveats.extend(_comparison_caveats(benchmark, as_of))
        source_refs = [
            _source_ref(INPUT_FILES[0], row),
            {"file": INPUT_FILES[1], "record_id": row["product_id"], "row_number": row.get("_metadata_row")},
        ]
        if benchmark:
            source_refs.extend(_source_ref(INPUT_FILES[2], peer, "competitor_product_id") for peer in benchmark["rows"])
        flagged.append({
            "id": f"sku-{row['product_id']}", "kind": "sku",
            "title": f"{details['verb']} {row['product_name']} ({row['product_id']})",
            "product_id": row["product_id"], "product_name": row["product_name"],
            "brand": row["brand"], "subcategory": row["subcategory"], "shade_group": row["shade_group"],
            "supplier": row["supplier"], "private_label": row["private_label"],
            "status": row["status"], "stock_status": row["stock_status"],
            "seasonality": row["seasonality"], "pack_size": row["pack_size"],
            "price_eur": row["price_eur"], "channel_revenue_eur_12w": revenue,
            "channel_units_12w": row["channel_units_sold_12w"],
            "channel_margin_pct": row["channel_margin_pct"],
            "channel_trend_12w_pct": row["channel_sales_trend_12w_pct"],
            "market_revenue_eur_12w": market,
            "market_trend_12w_pct": row["market_sales_trend_12w_pct"],
            "channel_to_market_ratio_pct": ratio * 100 if ratio is not None else None,
            "peer_ratio_pct": peer_ratio * 100 if peer_ratio is not None else None,
            "peer_margin_pct": peer_margin,
            "peer_count": len(peers), "peer_ids": sorted(peer["product_id"] for peer in peers),
            "comp_benchmark_price_eur": comp_price,
            "competitor_rows": benchmark["comp_n"] if benchmark else 0,
            "shelf_space_cm": row["shelf_space_cm"],
            "primary_action": action, "priority_tier": details["tier"], "priority_order": primary["order"],
            "rationale": primary["rationale"],
            "next_step": (
                "Also verify current availability before making a volume-dependent commercial change. "
                if supply_context else ""
            ) + details["step"],
            "suggested_owner": details["owner"], "success_measure": details["measure"],
            "evidence_strength": evidence_strength,
            "evidence_reason": (
                f"{len(benchmark['rows'])} category/shade competitor observations; independent sources and pack/form comparability are not established."
                if action == "Review price benchmark"
                else "Source fields support a review; a single snapshot does not establish the cause, commercial feasibility or probability of success."
            ),
            "caveats": caveats, "source_refs": source_refs,
            "competitor_examples": [competitor_example(peer) for peer in benchmark["rows"]] if benchmark else [],
            "scenario": primary["scenario"],
            "also_flagged": [candidate["action"] for candidate in candidates[1:]],
        })
    flagged.sort(key=_decision_sort)
    return flagged, thresholds, overall_ratio


def _decision_sort(item):
    scenario = item["scenario"]["value_eur"]
    return (
        item["priority_order"],
        -(item.get("market_revenue_eur_12w", 0) if item["priority_order"] == 0 else scenario or 0),
        -item.get("market_revenue_eur_12w", 0),
        item["id"],
    )


def assortment_gaps(sku, bench, comp=None, as_of=None):
    as_of = as_of or date.today()
    gaps = []
    for (subcategory, shade), benchmark in sorted(bench.items()):
        existing = [row for row in sku if row["subcategory"] == subcategory and row["shade_group"] == shade]
        active = [row for row in existing if row["status"] == "aktiv"]
        available = [row for row in active if row["stock_status"] != "out_of_stock"]
        signal = benchmark["comp_signal"]
        strong = (
            signal is not None and signal >= CFG["gap_signal_min"]
        ) or benchmark["comp_trend"] >= CFG["gap_trend_min"]
        # Existing active products count as assortment coverage even when out of stock.
        if not strong or len(active) > CFG["gap_max_active_cover"]:
            continue
        score = signal * (1 + max(0.0, min(benchmark["comp_trend"], 0.6))) if signal is not None else None
        key = hashlib.sha256(f"{subcategory}\0{shade}".encode("utf-8")).hexdigest()[:12]
        step = (
            "Check existing inactive products and the reason for inactivity before adding a substitute. "
            if existing and not active else
            "Check availability of the existing active product before interpreting this as a new range gap. "
            if active and not available else ""
        )
        gaps.append({
            "id": f"gap-{key}", "kind": "gap",
            "title": f"Validate demand for {subcategory} / {shade}",
            "subcategory": subcategory, "shade_group": shade,
            "primary_action": "Assortment follow-up", "priority_tier": "Validate first", "priority_order": 10,
            "rationale": (
                f"{benchmark['comp_n']} competitor observation(s); {len(active)} active products, "
                f"{len(available)} currently available. Popularity "
                f"{f'{signal:.1f}/100' if signal is not None else 'unavailable after invalid-score exclusions'}, "
                f"mean trend {benchmark['comp_trend']:+.1%}."
            ),
            "next_step": step + "Refresh the signal and validate product form, pack size and supplier feasibility before a small range trial.",
            "suggested_owner": "Category buyer",
            "success_measure": "Validated demand and supply evidence; if approved, trial sell-through and gross profit.",
            "evidence_strength": "Limited comparison",
            "evidence_reason": f"{benchmark['comp_n']} observations, {benchmark['valid_signal_rows']} valid popularity scores. Row count is not proof of independent corroboration.",
            "caveats": _comparison_caveats(benchmark, as_of),
            "source_refs": [
                _source_ref(INPUT_FILES[2], row, "competitor_product_id") for row in benchmark["rows"]
            ] + [_source_ref(INPUT_FILES[0], row) for row in existing],
            "competitor_examples": [competitor_example(row) for row in benchmark["rows"]],
            "scenario": _scenario(), "also_flagged": [],
            "competitor_signal_0_100": signal,
            "competitor_trend_12w_pct": benchmark["comp_trend"],
            "competitor_rows": benchmark["comp_n"], "valid_signal_rows": benchmark["valid_signal_rows"],
            "active_skus_held": len(active), "available_skus_held": len(available),
            "existing_product_ids": sorted(row["product_id"] for row in existing),
            "gap_score": round(score, 2) if score is not None else None,
        })
    gaps.sort(key=lambda gap: (-(gap["gap_score"] or 0), gap["id"]))
    return gaps


def recommendations(flagged, gaps, summary=None):
    ordered = sorted(flagged, key=_decision_sort) + gaps
    selected, actions = [], set()
    for item in ordered:
        if item["primary_action"] not in actions:
            selected.append(item)
            actions.add(item["primary_action"])
        if len(selected) == 5:
            break
    if len(selected) < 3:
        selected_ids = {item["id"] for item in selected}
        for item in ordered:
            if item["id"] not in selected_ids:
                selected.append(item)
                selected_ids.add(item["id"])
            if len(selected) >= 3:
                break
    return selected


def build_summary(sku, flagged, gaps):
    channel = sum(row["channel_revenue_eur_12w"] for row in sku)
    market = sum(row["market_revenue_eur_12w"] for row in sku)
    action_counts = dict(Counter(row["primary_action"] for row in flagged))
    availability = [row for row in flagged if row["primary_action"] == "Fix availability"]
    return {
        "n_skus": len(sku), "n_flagged": len(flagged),
        "channel_rev": round(channel, 2), "market_rev": round(market, 2),
        "channel_to_market_ratio_pct": 100 * channel / market if market else None,
        "revenue_scenario_eur": round(sum(
            row["scenario"]["value_eur"] or 0 for row in flagged if row["scenario"]["value_type"] == "Revenue"
        ), 2),
        "gross_profit_scenario_eur": round(sum(
            row["scenario"]["value_eur"] or 0 for row in flagged if row["scenario"]["value_type"] == "Gross profit"
        ), 2),
        "availability_out_of_stock": sum(row["stock_status"] == "out_of_stock" for row in availability),
        "availability_low_stock": sum(row["stock_status"] == "low_stock" for row in availability),
        "zero_sales_count": action_counts.get("Investigate zero sales", 0),
        "reactivation_count": action_counts.get("Review reactivation", 0),
        "action_counts": action_counts,
    }


def build_review(as_of=None, base=BASE):
    as_of = as_of or date.today()
    sku, comp = load(base)
    benchmarks = competitor_benchmarks(comp)
    flagged, thresholds, _ = classify(sku, benchmarks, as_of)
    gaps = assortment_gaps(sku, benchmarks, as_of=as_of)
    summary = build_summary(sku, flagged, gaps)
    by_id = {row["product_id"]: row for row in flagged}
    landscape = []
    groups = {}
    for row in sku:
        decision = by_id.get(row["product_id"])
        landscape.append({
            "id": f"sku-{row['product_id']}", "product_id": row["product_id"],
            "product_name": row["product_name"], "brand": row["brand"], "subcategory": row["subcategory"],
            "market_revenue_eur_12w": row["market_revenue_eur_12w"],
            "channel_revenue_eur_12w": row["channel_revenue_eur_12w"],
            "channel_to_market_ratio_pct": row["chan_share"] * 100 if row["chan_share"] is not None else None,
            "primary_action": decision["primary_action"] if decision else "No rule matched",
            "scenario_value_eur": decision["scenario"]["value_eur"] if decision else None,
            "scenario_type": decision["scenario"]["value_type"] if decision else "Not estimated",
        })
        groups.setdefault(row["subcategory"], []).append(row)
    subcategories = []
    for name, rows in sorted(groups.items()):
        channel = sum(row["channel_revenue_eur_12w"] for row in rows)
        market = sum(row["market_revenue_eur_12w"] for row in rows)
        subcategories.append({
            "subcategory": name, "channel_rev": round(channel, 2), "market_rev": round(market, 2),
            "ratio_pct": 100 * channel / market if market else None, "n": len(rows),
        })
    fingerprint = hashlib.sha256(
        json.dumps({"rules": RULE_VERSION, "config": CFG}, sort_keys=True).encode("utf-8")
    )
    for filename in INPUT_FILES:
        fingerprint.update(filename.encode("utf-8") + b"\0" + (Path(base) / filename).read_bytes())
    return {
        "schema_version": 2, "snapshot_id": fingerprint.hexdigest()[:20],
        "generated": as_of.isoformat(), "data_quality": data_quality(sku, comp, as_of),
        "summary": summary, "methodology": {**METHODOLOGY, "thresholds": thresholds},
        "recommendations": recommendations(flagged, gaps),
        "opportunities": flagged, "assortment_gaps": gaps,
        "landscape": landscape, "subcategories": subcategories,
    }


def csv_cell(value):
    if isinstance(value, (list, dict)):
        value = json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)
    if isinstance(value, str) and re.match(r"^\s*[=+\-@]", value):
        return "'" + value
    return value


def write_csv(path, rows, fields):
    with open(path, "w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: csv_cell(row.get(key)) for key in fields})


def _markdown(value):
    return str(value).replace("|", r"\|").replace("\r", " ").replace("\n", " ")


def render_markdown(payload):
    summary, quality = payload["summary"], payload["data_quality"]
    lines = [
        "# Category review: Hair Coloration",
        f"ZenBeauty Retail | Generated {payload['generated']} | Review snapshot `{payload['snapshot_id']}`",
        "",
        "> Synthetic data. Proposed reviews and experiments, not approved orders or range changes.",
        "",
        "## Start here",
        f"{len(payload['recommendations'])} specific decisions selected from {summary['n_flagged']} flagged SKUs and {len(payload['assortment_gaps'])} assortment follow-ups.",
        METHODOLOGY["selection"],
        "",
    ]
    for index, item in enumerate(payload["recommendations"], 1):
        lines.extend([
            f"### {index}. {_markdown(item['title'])}",
            f"**Priority:** {item['priority_tier']} | **Evidence:** {item['evidence_strength']}",
            f"**Why:** {_markdown(item['rationale'])}",
            f"**Next action:** {_markdown(item['next_step'])}",
            f"**Proposed owner:** {item['suggested_owner']} (not assigned)",
            f"**Success measure:** {_markdown(item['success_measure'])}",
        ])
        if item["kind"] == "sku":
            lines.extend([
                f"**Snapshot:** `{item['product_id']}`; {item['status']}; {item['stock_status']}; {item['seasonality']}; {item['pack_size']}.",
                f"Channel {eur(item['channel_revenue_eur_12w'])}, {item['channel_units_12w']} units, margin {item['channel_margin_pct']:.1%}, trend {item['channel_trend_12w_pct']:+.1%}. Market-demand proxy {eur(item['market_revenue_eur_12w'])}, trend {item['market_trend_12w_pct']:+.1%}.",
            ])
        scenario = item["scenario"]
        scenario_label = (
            "Not estimated" if scenario["value_eur"] is None
            else f"{scenario['value_type']} / {eur(scenario['value_eur'])}"
        )
        lines.extend([
            f"**12-week scenario:** {scenario_label}. {_markdown(scenario['formula'])}",
            f"**Assumptions:** {' '.join(_markdown(value) for value in scenario['assumptions'])}",
            f"**Evidence limitation:** {_markdown(item['evidence_reason'])}",
            f"**Caveats:** {' '.join(_markdown(value) for value in item['caveats'])}",
            "**Sources:** " + "; ".join(
                f"`{ref['file']}` / `{ref['record_id']}`" + (f" / row {ref['row_number']}" if ref["row_number"] else "")
                for ref in item["source_refs"]
            ),
            "",
        ])
    lines.extend([
        "## Snapshot and scenarios",
        f"Channel revenue: {eur(summary['channel_rev'])}; market-demand proxy: {eur(summary['market_rev'])}, both over the supplied 12-week window.",
        f"Revenue benchmark-distance scenarios: {eur(summary['revenue_scenario_eur'])}. Gross-profit scenarios: {eur(summary['gross_profit_scenario_eur'])}.",
        METHODOLOGY["scenario"],
        "",
        "| Review type | SKU count |",
        "|---|---:|",
    ])
    lines.extend(f"| {_markdown(action)} | {count} |" for action, count in summary["action_counts"].items())
    lines.extend([
        "",
        "## Evidence quality and dates",
        f"Competitor observations: {quality['competitor_observed_from'] or 'Not supplied'} to {quality['competitor_observed_to'] or 'Not supplied'}. Generated date is not a data refresh.",
        METHODOLOGY["evidence"],
    ])
    lines.extend(f"- {_markdown(warning)}" for warning in quality["warnings"])
    if quality["exclusions"]:
        lines.extend(["", "| Excluded popularity score | Raw value | Source row |", "|---|---:|---:|"])
        lines.extend(
            f"| {row['record_id']} | {row['value']} | {row['row_number']} |"
            for row in quality["exclusions"]
        )
    lines.extend([
        "",
        "## Handoff",
        "Use View evidence in the dashboard to inspect metrics, comparator records and calculation assumptions. Add selected items to the review plan, record an owner/due date/decision/status/notes, then export the plan.",
        "Plan edits are browser-local, not assignments or shared workflow state. File and hosted versions may have different storage; export before switching browsers or origins.",
        "Full decision evidence is in `outputs/review.json`; flat action lists are in `outputs/opportunities.csv` and `outputs/assortment_gaps.csv`.",
        "",
    ])
    return "\n".join(lines)


def load_architecture():
    directory = Path(BASE) / "architecture"
    proposal = json.loads((directory / "production.json").read_text(encoding="utf-8"))
    mermaid = (directory / "production.mmd").read_text(encoding="utf-8")
    svg = (directory / "production.svg").read_text(encoding="utf-8")
    provenance = json.loads((directory / "production.render.json").read_text(encoding="utf-8"))
    for filename, field in (
        ("production.mmd", "source_sha256"), ("production.svg", "svg_sha256"),
        ("production.png", "png_sha256"),
    ):
        if hashlib.sha256((directory / filename).read_bytes()).hexdigest() != provenance[field]:
            raise ValueError("Architecture source or artwork changed. Run 'npm --prefix presentation run architecture' before regenerating the dashboard.")
    if hashlib.sha256((Path(BASE) / "presentation" / "mermaid.config.json").read_bytes()).hexdigest() != provenance["config_sha256"]:
        raise ValueError("Architecture rendering configuration changed; rebuild the Mermaid preview.")
    try:
        root = ElementTree.fromstring(svg)
    except ElementTree.ParseError as exc:
        raise ValueError("The architecture SVG is malformed; rebuild the Mermaid preview.") from exc
    if root.tag != "{http://www.w3.org/2000/svg}svg":
        raise ValueError("The architecture preview must be a rendered SVG diagram.")
    for element in root.iter():
        if element.tag.rsplit("}", 1)[-1] in {"script", "foreignObject"}:
            raise ValueError("The architecture preview must not contain scripts or external HTML.")
    if not mermaid.lstrip().startswith("flowchart"):
        raise ValueError("The architecture source must contain a Mermaid flowchart.")
    return {
        **proposal,
        "mermaid_source": mermaid,
        "diagram_svg": svg,
        "diagram_data_uri": "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii"),
    }


def render_dashboard(payload):
    template = (Path(BASE) / "dashboard_template.html").read_text(encoding="utf-8")
    if template.count("__DATA__") != 1:
        raise ValueError("dashboard_template.html must contain exactly one __DATA__ placeholder")
    data = json.dumps(
        {**payload, "architecture": load_architecture()},
        ensure_ascii=False, allow_nan=False, sort_keys=True,
    )
    for char, escaped in (("<", r"\u003c"), (">", r"\u003e"), ("&", r"\u0026"), ("\u2028", r"\u2028"), ("\u2029", r"\u2029")):
        data = data.replace(char, escaped)
    return template.replace("__DATA__", data)


def write_outputs(payload, output_dir=OUT, root=BASE):
    dashboard = render_dashboard(payload)
    report = render_markdown(payload)
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    common_fields = [
        "id", "title", "primary_action", "priority_tier", "evidence_strength", "evidence_reason",
        "rationale", "next_step", "suggested_owner", "success_measure", "scenario_value_eur",
        "scenario_type", "scenario_period", "scenario_formula", "scenario_assumptions",
        "also_flagged", "caveats", "source_refs", "competitor_examples",
    ]

    def flatten(items):
        return [{
            **item, "scenario_value_eur": item["scenario"]["value_eur"],
            "scenario_type": item["scenario"]["value_type"], "scenario_period": item["scenario"]["period"],
            "scenario_formula": item["scenario"]["formula"], "scenario_assumptions": item["scenario"]["assumptions"],
        } for item in items]

    write_csv(directory / "opportunities.csv", flatten(payload["opportunities"]), common_fields + [
        "product_id", "product_name", "brand", "subcategory", "shade_group", "supplier",
        "private_label", "status", "stock_status", "seasonality", "pack_size", "price_eur",
        "channel_revenue_eur_12w", "channel_units_12w", "channel_margin_pct", "channel_trend_12w_pct",
        "market_revenue_eur_12w", "market_trend_12w_pct", "channel_to_market_ratio_pct",
        "peer_ratio_pct", "peer_margin_pct", "peer_count", "peer_ids",
        "comp_benchmark_price_eur", "competitor_rows", "shelf_space_cm",
    ])
    write_csv(directory / "assortment_gaps.csv", flatten(payload["assortment_gaps"]), common_fields + [
        "subcategory", "shade_group", "competitor_signal_0_100", "competitor_trend_12w_pct",
        "competitor_rows", "valid_signal_rows", "active_skus_held", "available_skus_held",
        "existing_product_ids", "gap_score",
    ])
    (directory / "category_review.md").write_text(report, encoding="utf-8")
    (directory / "review.json").write_text(
        json.dumps(payload, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    (directory / "dashboard.html").write_text(dashboard, encoding="utf-8")
    (Path(root) / "index.html").write_text(dashboard, encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today(), help="Review date (YYYY-MM-DD); fixes freshness calculations for reproducible outputs.")
    arguments = parser.parse_args(argv)
    try:
        payload = build_review(arguments.as_of)
        write_outputs(payload)
    except (ValueError, OSError) as exc:
        parser.exit(1, f"Category review failed: {exc}\n")
    summary = payload["summary"]
    print(f"Category review: {summary['n_skus']} SKUs, {summary['n_flagged']} review items.")
    print(f"Selected decisions: {len(payload['recommendations'])}; competitor observations: {payload['data_quality']['competitor_observed_to'] or 'not supplied'}.")
    print(f"Excluded invalid popularity scores: {payload['data_quality']['invalid_signal_count']}. See the data-quality warnings.")
    print("Scenarios are not forecasts; revenue and gross-profit effects are separate.")
    print("Generated outputs: dashboard.html, category_review.md, opportunities.csv, assortment_gaps.csv, review.json; root index.html.")


if __name__ == "__main__":
    main()
