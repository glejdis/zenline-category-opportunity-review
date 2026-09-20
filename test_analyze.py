#!/usr/bin/env python3
"""
Unit tests for the category-opportunity rule engine (analyze.py).

Pure standard library (unittest) — no third-party dependencies, matching the pipeline.
Three layers:
  1. TestHelpers        exact math for percentile / coercion / formatting
  2. TestBenchmarks     competitor benchmark aggregation
  3. TestRules          each business rule in isolation on a controlled fixture
  4. TestAssortmentGaps cell-level gap detection + ranking
  5. TestRealDataset    regression locks against the shipped CSVs (skipped if absent)

Run:  python -m unittest test_analyze -v      (or)   python test_analyze.py
"""

import os
import unittest

import analyze
from analyze import (percentile, median, to_float, to_int, to_bool, eur,
                     competitor_benchmarks, classify, assortment_gaps, load)


def sku(**kw):
    """Factory for a SKU row with sensible defaults; chan_share is derived unless given."""
    d = {
        "product_id": "X", "product_name": "Test Product", "brand": "TestBrand",
        "subcategory": "Permanent Color", "shade_group": "Blonde", "seasonality": "Evergreen",
        "status": "aktiv", "stock_status": "in_stock", "private_label": False,
        "price_eur": 12.0, "pack_size": "100 ml", "attributes": "",
        "channel_revenue_eur_12w": 5000.0, "channel_units_sold_12w": 400.0,
        "channel_margin_pct": 0.40, "channel_sales_trend_12w_pct": 0.10,
        "market_revenue_eur_12w": 60000.0, "market_units_sold_12w": 5000.0,
        "market_sales_trend_12w_pct": 0.10, "shelf_space_cm": 10.0, "supplier": "Supp",
    }
    d.update(kw)
    m = d["market_revenue_eur_12w"]
    if "chan_share" not in kw:
        d["chan_share"] = d["channel_revenue_eur_12w"] / m if m else 0.0
    return d


class TestHelpers(unittest.TestCase):
    def test_percentile_linear(self):
        xs = [0, 10, 20, 30, 40]
        self.assertAlmostEqual(percentile(xs, 0.0), 0)
        self.assertAlmostEqual(percentile(xs, 0.25), 10)
        self.assertAlmostEqual(percentile(xs, 0.5), 20)
        self.assertAlmostEqual(percentile(xs, 1.0), 40)
        # interpolated point between samples
        self.assertAlmostEqual(percentile([1, 2, 3, 4], 0.5), 2.5)

    def test_percentile_empty(self):
        self.assertEqual(percentile([], 0.5), 0.0)

    def test_median(self):
        self.assertEqual(median([3, 1, 2]), 2)
        self.assertEqual(median([1, 2, 3, 4]), 2.5)

    def test_coercion(self):
        self.assertEqual(to_float("3.5"), 3.5)
        self.assertEqual(to_float("bad", 1.0), 1.0)
        self.assertEqual(to_int("7.9"), 7)
        self.assertEqual(to_int("nope", -1), -1)
        self.assertTrue(to_bool("True"))
        self.assertTrue(to_bool("true"))
        self.assertFalse(to_bool("False"))
        self.assertFalse(to_bool(""))

    def test_eur(self):
        self.assertEqual(eur(1234567), "€1,234,567")
        self.assertEqual(eur(0), "€0")


class TestBenchmarks(unittest.TestCase):
    def test_median_price_and_signals(self):
        comp = [
            {"subcategory": "Toner / Gloss", "shade_group": "Copper",
             "price_eur": 10.0, "signal_score_0_100": 80.0, "trend_score_12w_pct": 0.2},
            {"subcategory": "Toner / Gloss", "shade_group": "Copper",
             "price_eur": 20.0, "signal_score_0_100": 60.0, "trend_score_12w_pct": 0.4},
            {"subcategory": "Toner / Gloss", "shade_group": "Copper",
             "price_eur": 30.0, "signal_score_0_100": 40.0, "trend_score_12w_pct": 0.0},
        ]
        b = competitor_benchmarks(comp)[("Toner / Gloss", "Copper")]
        self.assertEqual(b["comp_med_price"], 20.0)     # median of 10/20/30
        self.assertAlmostEqual(b["comp_signal"], 60.0)  # mean of 80/60/40
        self.assertAlmostEqual(b["comp_trend"], 0.2)
        self.assertEqual(b["comp_n"], 3)


class TestRules(unittest.TestCase):
    """Each rule proven in isolation on one controlled 11-SKU population."""

    @classmethod
    def setUpClass(cls):
        cls.pop = [
            sku(product_id="T-AVAIL", shade_group="Ash Blonde", stock_status="low_stock",
                market_revenue_eur_12w=200000, channel_revenue_eur_12w=8000,
                channel_margin_pct=0.42, channel_sales_trend_12w_pct=0.10, market_sales_trend_12w_pct=0.30),
            sku(product_id="T-PROMO", shade_group="Blonde",
                market_revenue_eur_12w=300000, channel_revenue_eur_12w=9000,
                channel_margin_pct=0.42, channel_sales_trend_12w_pct=0.20, market_sales_trend_12w_pct=0.30),
            sku(product_id="T-INAKTIV", shade_group="Dark Brown", status="inaktiv",
                market_revenue_eur_12w=30000, channel_revenue_eur_12w=1000,
                channel_margin_pct=0.40, channel_sales_trend_12w_pct=0.0, market_sales_trend_12w_pct=0.10),
            sku(product_id="T-DEAD", shade_group="Copper",
                market_revenue_eur_12w=10000, channel_revenue_eur_12w=200,
                channel_margin_pct=0.45, channel_sales_trend_12w_pct=-0.10, market_sales_trend_12w_pct=-0.20),
            sku(product_id="T-MARGIN", shade_group="Medium Brown",
                market_revenue_eur_12w=250000, channel_revenue_eur_12w=25000,
                channel_margin_pct=0.15, channel_sales_trend_12w_pct=0.10, market_sales_trend_12w_pct=0.0),
            sku(product_id="T-PRICE", shade_group="Vivid", price_eur=12.0,
                market_revenue_eur_12w=60000, channel_revenue_eur_12w=1500,
                channel_margin_pct=0.40, channel_sales_trend_12w_pct=-0.20, market_sales_trend_12w_pct=0.02),
            sku(product_id="T-HEALTHY", shade_group="Auburn",
                market_revenue_eur_12w=60000, channel_revenue_eur_12w=6000,
                channel_margin_pct=0.42, channel_sales_trend_12w_pct=0.10, market_sales_trend_12w_pct=0.10),
            sku(product_id="F1", shade_group="Silver/Grey", market_revenue_eur_12w=50000,
                channel_revenue_eur_12w=4000, channel_margin_pct=0.38, market_sales_trend_12w_pct=0.05),
            sku(product_id="F2", shade_group="Red", market_revenue_eur_12w=45000,
                channel_revenue_eur_12w=3500, channel_margin_pct=0.39, market_sales_trend_12w_pct=0.03),
            sku(product_id="F3", shade_group="Light Brown", market_revenue_eur_12w=70000,
                channel_revenue_eur_12w=5500, channel_margin_pct=0.41, market_sales_trend_12w_pct=0.08),
            sku(product_id="F4", shade_group="Black", market_revenue_eur_12w=35000,
                channel_revenue_eur_12w=2500, channel_margin_pct=0.40, market_sales_trend_12w_pct=0.0),
        ]
        cls.bench = {("Permanent Color", "Vivid"):
                     {"comp_med_price": 5.0, "comp_signal": 50.0, "comp_trend": 0.1, "comp_n": 3}}
        flagged, _, _ = classify(cls.pop, cls.bench)
        cls.by_id = {f["product_id"]: f for f in flagged}

    def test_fix_availability(self):
        self.assertEqual(self.by_id["T-AVAIL"]["primary_action"], "Fix availability")
        self.assertGreater(self.by_id["T-AVAIL"]["opportunity_value_eur"], 0)

    def test_promote(self):
        self.assertEqual(self.by_id["T-PROMO"]["primary_action"], "Promote")
        self.assertGreater(self.by_id["T-PROMO"]["opportunity_value_eur"], 0)

    def test_delist_inactive(self):
        self.assertEqual(self.by_id["T-INAKTIV"]["primary_action"], "Delist / markdown")

    def test_delist_dead_active(self):
        self.assertEqual(self.by_id["T-DEAD"]["primary_action"], "Delist / markdown")

    def test_margin_repair(self):
        row = self.by_id["T-MARGIN"]
        self.assertEqual(row["primary_action"], "Price / margin")
        self.assertGreater(row["opportunity_value_eur"], 0)

    def test_overpriced_decliner(self):
        row = self.by_id["T-PRICE"]
        self.assertEqual(row["primary_action"], "Price / margin")
        self.assertGreater(row["price_index"], 1.15)

    def test_healthy_not_flagged(self):
        self.assertNotIn("T-HEALTHY", self.by_id)

    def test_opportunity_value_nonnegative(self):
        for f in self.by_id.values():
            self.assertGreaterEqual(f["opportunity_value_eur"], 0)

    def test_potential_and_gap_math(self):
        # value = max(0, market * subcat-median-share - channel). For a below-share SKU it is positive.
        row = self.by_id["T-PROMO"]
        self.assertLessEqual(row["opportunity_value_eur"], row["modeled_potential_eur"])

    def test_determinism(self):
        a, _, _ = classify(self.pop, self.bench)
        b, _, _ = classify(self.pop, self.bench)
        self.assertEqual(a, b)

    def test_confidence_grades(self):
        # first-party-data actions are High; a benchmark-only price flag is graded by comp sample
        for pid in ["T-AVAIL", "T-PROMO", "T-INAKTIV", "T-DEAD", "T-MARGIN"]:
            self.assertEqual(self.by_id[pid]["confidence"], "High")
        self.assertEqual(self.by_id["T-PRICE"]["confidence"], "Medium")  # bench comp_n = 3
        for f in self.by_id.values():
            self.assertIn(f["confidence"], {"High", "Medium", "Low"})

    def test_priority_and_also_flagged(self):
        # A SKU that trips BOTH availability (low stock, rising) and margin (thin margin, high rev).
        pop = [
            sku(product_id="COMBO", stock_status="low_stock", market_revenue_eur_12w=200000,
                channel_revenue_eur_12w=20000, channel_margin_pct=0.15,
                channel_sales_trend_12w_pct=0.10, market_sales_trend_12w_pct=0.30),
            sku(product_id="B", market_revenue_eur_12w=100000, channel_revenue_eur_12w=8000, channel_margin_pct=0.40),
            sku(product_id="C", market_revenue_eur_12w=80000, channel_revenue_eur_12w=6000, channel_margin_pct=0.41),
            sku(product_id="D", market_revenue_eur_12w=40000, channel_revenue_eur_12w=3000, channel_margin_pct=0.42),
        ]
        flagged, _, _ = classify(pop, {})
        combo = {f["product_id"]: f for f in flagged}["COMBO"]
        covered = {combo["primary_action"]} | set(
            x.strip() for x in combo["also_flagged"].split(";") if x.strip())
        self.assertIn("Fix availability", covered)
        self.assertIn("Price / margin", covered)
        self.assertTrue(combo["also_flagged"])  # a second action was recorded


class TestAssortmentGaps(unittest.TestCase):
    def setUp(self):
        # Two strong competitor cells with no coverage (gaps) + one strong but well-covered cell.
        self.comp = [
            {"subcategory": "Toner / Gloss", "shade_group": "Copper",
             "competitor_product_name": "Rival Copper Toner", "brand": "RivalCo",
             "price_eur": 10.0, "signal_score_0_100": 90.0, "trend_score_12w_pct": 0.30},
            {"subcategory": "Bleach / Lightener", "shade_group": "Red",
             "competitor_product_name": "Rival Red Bleach", "brand": "RivalCo",
             "price_eur": 12.0, "signal_score_0_100": 70.0, "trend_score_12w_pct": 0.10},
            {"subcategory": "Permanent Color", "shade_group": "Blonde",
             "competitor_product_name": "Rival Blonde", "brand": "RivalCo",
             "price_eur": 9.0, "signal_score_0_100": 95.0, "trend_score_12w_pct": 0.20},
        ]
        self.sku = [
            sku(product_id="P1", subcategory="Permanent Color", shade_group="Blonde"),
            sku(product_id="P2", subcategory="Permanent Color", shade_group="Blonde"),
        ]
        self.bench = competitor_benchmarks(self.comp)

    def test_gap_detection(self):
        gaps = assortment_gaps(self.sku, self.bench)
        cells = {(g["subcategory"], g["shade_group"]) for g in gaps}
        self.assertIn(("Toner / Gloss", "Copper"), cells)         # strong, 0 coverage
        self.assertIn(("Bleach / Lightener", "Red"), cells)       # strong, 0 coverage
        self.assertNotIn(("Permanent Color", "Blonde"), cells)    # strong but 2 active SKUs

    def test_gap_coverage_and_ranking(self):
        gaps = assortment_gaps(self.sku, self.bench)
        for g in gaps:
            self.assertLessEqual(g["active_skus_held"], 1)
        scores = [g["gap_score"] for g in gaps]
        self.assertEqual(scores, sorted(scores, reverse=True))     # descending
        self.assertEqual(gaps[0]["shade_group"], "Copper")         # 90*(1.3) beats 70*(1.1)

    def test_examples_and_confidence(self):
        gaps = assortment_gaps(self.sku, self.bench, self.comp)
        copper = next(g for g in gaps if g["shade_group"] == "Copper")
        self.assertTrue(copper["examples"])                         # named products to source
        self.assertEqual(copper["examples"][0]["name"], "Rival Copper Toner")
        self.assertEqual(copper["confidence"], "Low")               # single competitor row
        for g in gaps:
            self.assertIn(g["confidence"], {"High", "Medium", "Low"})


_CSV = os.path.join(analyze.BASE, "sku_performance.csv")


@unittest.skipUnless(os.path.exists(_CSV), "shipped dataset not present")
class TestRealDataset(unittest.TestCase):
    """Regression locks on the real, deterministic dataset."""

    @classmethod
    def setUpClass(cls):
        sku_rows, comp = load()
        bench = competitor_benchmarks(comp)
        cls.flagged, _, _ = classify(sku_rows, bench)
        cls.gaps = assortment_gaps(sku_rows, bench)
        cls.by_id = {f["product_id"]: f for f in cls.flagged}
        cls.counts = {}
        for f in cls.flagged:
            cls.counts[f["primary_action"]] = cls.counts.get(f["primary_action"], 0) + 1

    def test_counts_regression(self):
        self.assertEqual(self.counts.get("Fix availability"), 31)
        self.assertEqual(self.counts.get("Promote"), 10)
        self.assertEqual(self.counts.get("Price / margin"), 40)
        self.assertEqual(self.counts.get("Delist / markdown"), 47)
        self.assertEqual(len(self.flagged), 128)
        self.assertEqual(len(self.gaps), 19)

    def test_known_anchor_skus(self):
        self.assertEqual(self.by_id["HC0143"]["primary_action"], "Fix availability")
        self.assertEqual(self.by_id["HC0024"]["primary_action"], "Price / margin")
        self.assertEqual(self.by_id["HC0003"]["primary_action"], "Delist / markdown")

    def test_invariants(self):
        allowed = {"Fix availability", "Promote", "Delist / markdown", "Price / margin"}
        for f in self.flagged:
            self.assertIn(f["primary_action"], allowed)
            self.assertGreaterEqual(f["opportunity_value_eur"], 0)
        for g in self.gaps:
            self.assertLessEqual(g["active_skus_held"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
