"""Business guardrails and output-contract tests. Run: python -m unittest -v."""

import copy
import csv
import hashlib
import json
import math
import shutil
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import analyze

AS_OF = date(2026, 9, 20)


def sku(**changes):
    row = {
        "product_id": "SUBJECT", "product_name": "Test product", "brand": "Test brand",
        "category": "Beauty > Hair Coloration", "subcategory": "Permanent Color",
        "shade_group": "Blonde", "seasonality": "Evergreen", "status": "aktiv",
        "stock_status": "in_stock", "private_label": False, "price_eur": 12.0,
        "pack_size": "100 ml", "attributes": "", "channel_revenue_eur_12w": 10000.0,
        "channel_units_sold_12w": 1000, "channel_margin_pct": 0.40,
        "channel_sales_trend_12w_pct": 0.10, "market_revenue_eur_12w": 100000.0,
        "market_units_sold_12w": 10000, "market_sales_trend_12w_pct": 0.10,
        "shelf_space_cm": 10.0, "supplier": "Test supplier", "_source_row": 2,
        "_metadata_row": 2,
    }
    row.update(changes)
    row["chan_share"] = (
        row["channel_revenue_eur_12w"] / row["market_revenue_eur_12w"]
        if row["market_revenue_eur_12w"] else None
    )
    return row


def competitor(**changes):
    row = {
        "competitor_product_id": "COMP-1", "competitor_product_name": "Comparable colour",
        "brand": "Rival", "category": "Beauty > Hair Coloration",
        "subcategory": "Permanent Color", "shade_group": "Blonde",
        "price_eur": 8.0, "rank_or_popularity_signal": 20.0,
        "signal_score_0_100": 80.0, "source": "example.test",
        "trend_score_12w_pct": 0.30, "observed_date": "2026-07-01", "_source_row": 2,
    }
    row.update(changes)
    return row


class TestMath(unittest.TestCase):
    def test_percentile_interpolation_and_unsorted_values(self):
        self.assertEqual(analyze.percentile([40, 0, 30, 10, 20], 0.25), 10)
        self.assertEqual(analyze.percentile([1, 2, 3, 4], 0.5), 2.5)
        self.assertEqual(analyze.percentile([1, 2], 0), 1)
        self.assertEqual(analyze.percentile([1, 2], 1), 2)
        self.assertEqual(analyze.percentile([3], 0.75), 3)
        self.assertEqual(analyze.median([3, 1, 2]), 2)

    def test_missing_cohort_is_not_a_zero_benchmark(self):
        self.assertIsNone(analyze.median([]))
        with self.assertRaises(ValueError):
            analyze.percentile([1, 2], 1.1)

    def test_numbers_fail_loudly_instead_of_becoming_zero(self):
        for invalid in ("bad", "", "NaN", "Infinity", "-Infinity"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                analyze.to_float(invalid)
        self.assertEqual(analyze.to_float("3.5"), 3.5)
        self.assertEqual(analyze.to_int("7.0"), 7)
        with self.assertRaises(ValueError):
            analyze.to_int("7.9")

    def test_booleans_are_explicit(self):
        for truthy in ("true", "True", "1", "yes"):
            self.assertTrue(analyze.to_bool(truthy))
        for falsy in ("false", "False", "0", "no"):
            self.assertFalse(analyze.to_bool(falsy))
        for invalid in ("", "perhaps", None):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                analyze.to_bool(invalid)

    def test_zero_and_unknown_are_distinct(self):
        self.assertEqual(analyze.eur(0), "€0.00")
        self.assertEqual(analyze.eur(None), "Not estimated")
        self.assertEqual(analyze.eur(1234.56), "€1,234.56")


class TestCommercialRules(unittest.TestCase):
    def setUp(self):
        self.peers = [sku(product_id=f"P{i}") for i in range(6)]

    def classify_subject(self, subject, observations=()):
        rows, _, _ = analyze.classify(
            self.peers + [subject], analyze.competitor_benchmarks(observations), AS_OF
        )
        return next((row for row in rows if row["product_id"] == subject["product_id"]), None)

    def test_healthy_flat_cohort_does_not_create_margin_flags(self):
        self.assertIsNone(self.classify_subject(sku()))

    def test_low_stock_investigation_has_exact_revenue_scenario(self):
        row = self.classify_subject(sku(
            stock_status="low_stock", market_revenue_eur_12w=200000,
            channel_revenue_eur_12w=8000,
        ))
        self.assertEqual(row["primary_action"], "Fix availability")
        self.assertEqual(row["priority_order"], 1)
        self.assertEqual(row["scenario"]["value_type"], "Revenue")
        self.assertEqual(row["scenario"]["value_eur"], 12000.0)
        self.assertEqual(row["peer_ratio_pct"], 10.0)
        self.assertEqual(row["peer_count"], 6)
        self.assertNotIn(row["product_id"], row["peer_ids"])
        self.assertIn("unknown", row["rationale"])

    def test_out_of_stock_is_prioritised_even_with_zero_scenario(self):
        row = self.classify_subject(sku(
            stock_status="out_of_stock", channel_revenue_eur_12w=20000,
        ))
        self.assertEqual(row["primary_action"], "Fix availability")
        self.assertEqual(row["priority_order"], 0)
        self.assertEqual(row["scenario"]["value_eur"], 0.0)

    def test_margin_cannot_hide_an_availability_blocker(self):
        row = self.classify_subject(sku(
            stock_status="out_of_stock", channel_revenue_eur_12w=20000,
            channel_margin_pct=0.15,
        ))
        self.assertEqual(row["primary_action"], "Fix availability")
        self.assertEqual(row["scenario"]["value_eur"], 0.0)
        self.assertIn("Review margin", row["also_flagged"])

    def test_zero_sales_bypasses_absolute_demand_threshold(self):
        row = self.classify_subject(sku(
            channel_revenue_eur_12w=0, channel_units_sold_12w=0,
            market_revenue_eur_12w=1000, seasonality="Summer",
        ))
        self.assertEqual(row["primary_action"], "Investigate zero sales")
        self.assertEqual(row["evidence_strength"], "Needs context")
        self.assertIsNone(row["scenario"]["value_eur"])
        self.assertTrue(any("Summer" in caveat for caveat in row["caveats"]))
        self.assertNotIn("Test promotion", row["also_flagged"])

    def test_zero_units_positive_revenue_is_investigated(self):
        row = self.classify_subject(sku(channel_units_sold_12w=0))
        self.assertEqual(row["primary_action"], "Investigate zero sales")

    def test_inactive_growing_product_is_not_delisted_or_promoted(self):
        row = self.classify_subject(sku(
            status="inaktiv", stock_status="out_of_stock", channel_revenue_eur_12w=0,
            channel_units_sold_12w=0, market_sales_trend_12w_pct=0.27,
        ))
        self.assertEqual(row["primary_action"], "Review reactivation")
        self.assertEqual(row["also_flagged"], [])
        self.assertIsNone(row["scenario"]["value_eur"])
        self.assertIn("why the item is inactive", row["next_step"])

    def test_inactive_non_growing_product_requires_exit_confirmation(self):
        row = self.classify_subject(sku(status="inaktiv", market_sales_trend_12w_pct=-0.10))
        self.assertEqual(row["primary_action"], "Confirm exit")
        self.assertIn("remaining physical stock", row["next_step"])
        self.assertIsNone(row["scenario"]["value_eur"])

    def test_inactive_high_volume_low_margin_is_still_a_lifecycle_review(self):
        row = self.classify_subject(sku(
            status="inaktiv", channel_revenue_eur_12w=40000, channel_margin_pct=0.10,
        ))
        self.assertEqual(row["primary_action"], "Review reactivation")
        self.assertNotIn("Review margin", row["also_flagged"])

    def test_seasonal_declines_do_not_imply_delisting(self):
        row = self.classify_subject(sku(
            channel_revenue_eur_12w=100, market_sales_trend_12w_pct=-0.20,
            channel_sales_trend_12w_pct=-0.10, seasonality="Winter",
        ))
        self.assertEqual(row["primary_action"], "Review seasonal range")
        self.assertIsNone(row["scenario"]["value_eur"])
        self.assertTrue(any("window end is unknown" in caveat for caveat in row["caveats"]))

    def test_evergreen_decline_is_a_conditional_range_review(self):
        row = self.classify_subject(sku(
            channel_revenue_eur_12w=100, market_sales_trend_12w_pct=-0.20,
            channel_sales_trend_12w_pct=-0.10,
        ))
        self.assertEqual(row["primary_action"], "Review delist / markdown")
        self.assertIn("only if stock", row["next_step"])
        self.assertNotIn("frees", row["rationale"])

    def test_out_of_stock_decline_does_not_trigger_a_delist(self):
        self.assertIsNone(self.classify_subject(sku(
            stock_status="out_of_stock", channel_revenue_eur_12w=100,
            market_sales_trend_12w_pct=-0.20, channel_sales_trend_12w_pct=-0.10,
        )))

    def test_promotion_requires_sales_stock_growth_and_a_peer_gap(self):
        row = self.classify_subject(sku(
            market_revenue_eur_12w=300000, channel_revenue_eur_12w=9000,
            market_sales_trend_12w_pct=0.30,
        ))
        self.assertEqual(row["primary_action"], "Test promotion")
        self.assertEqual(row["scenario"]["value_eur"], 21000.0)
        self.assertIn("costs", row["success_measure"])

    def test_growth_boundary_does_not_trigger_promotion(self):
        self.assertIsNone(self.classify_subject(sku(
            market_revenue_eur_12w=300000, channel_revenue_eur_12w=9000,
            market_sales_trend_12w_pct=analyze.CFG["promote_min_mkt_trend"],
        )))

    def test_margin_scenario_is_gross_profit_not_revenue(self):
        row = self.classify_subject(sku(
            channel_revenue_eur_12w=20000, channel_margin_pct=0.20,
            market_sales_trend_12w_pct=0,
        ))
        self.assertEqual(row["primary_action"], "Review margin")
        self.assertEqual(row["scenario"]["value_type"], "Gross profit")
        self.assertEqual(row["scenario"]["value_eur"], 4000.0)
        self.assertIn("Holds current revenue constant", row["scenario"]["assumptions"][1])

    def test_margin_review_with_declining_demand_still_exposes_stock_constraints(self):
        row = self.classify_subject(sku(
            channel_revenue_eur_12w=20000, channel_margin_pct=0.20,
            market_sales_trend_12w_pct=-0.10, stock_status="out_of_stock",
        ))
        self.assertEqual(row["primary_action"], "Review margin")
        self.assertIn("verify current availability", row["next_step"])
        self.assertTrue(any("historical sales volume" in caveat for caveat in row["caveats"]))
    def test_price_comparison_is_limited_and_unquantified(self):
        row = self.classify_subject(sku(
            channel_sales_trend_12w_pct=-0.20, market_sales_trend_12w_pct=0,
        ), [competitor()])
        self.assertEqual(row["primary_action"], "Review price benchmark")
        self.assertEqual(row["evidence_strength"], "Limited comparison")
        self.assertIsNone(row["scenario"]["value_eur"])
        self.assertEqual(row["competitor_examples"][0]["record_id"], "COMP-1")
        self.assertEqual(row["competitor_examples"][0]["observed_date"], "2026-07-01")
        self.assertTrue(any("older than" in caveat for caveat in row["caveats"]))

    def test_zero_market_or_missing_peers_is_not_an_invented_benchmark(self):
        subject = sku(stock_status="out_of_stock")
        rows, _, _ = analyze.classify([subject], {}, AS_OF)
        self.assertIsNone(rows[0]["scenario"]["value_eur"])
        self.assertIsNone(rows[0]["peer_ratio_pct"])
        self.assertEqual(rows[0]["peer_count"], 0)
        rows, _, _ = analyze.classify([sku(status="inaktiv", market_revenue_eur_12w=0)], {}, AS_OF)
        self.assertIsNone(rows[0]["channel_to_market_ratio_pct"])

    def test_business_logic_does_not_mutate_source_rows(self):
        population = self.peers + [sku(stock_status="low_stock")]
        original = copy.deepcopy(population)
        first = analyze.classify(population, {}, AS_OF)
        second = analyze.classify(population, {}, AS_OF)
        self.assertEqual(population, original)
        self.assertEqual(first, second)


class TestCompetitorEvidence(unittest.TestCase):
    def test_benchmark_math_preserves_invalid_raw_score_but_excludes_it(self):
        observations = [
            competitor(competitor_product_id="A", price_eur=10, signal_score_0_100=80, trend_score_12w_pct=0.20),
            competitor(competitor_product_id="B", price_eur=20, signal_score_0_100=60, trend_score_12w_pct=0.40),
            competitor(competitor_product_id="C", price_eur=30, signal_score_0_100=104.8, trend_score_12w_pct=0),
        ]
        benchmark = analyze.competitor_benchmarks(observations)[("Permanent Color", "Blonde")]
        self.assertEqual(benchmark["comp_med_price"], 20)
        self.assertEqual(benchmark["comp_signal"], 70)
        self.assertEqual(benchmark["valid_signal_rows"], 2)
        self.assertAlmostEqual(benchmark["comp_trend"], 0.20)
        self.assertEqual(benchmark["rows"][2]["signal_score_0_100"], 104.8)
        self.assertFalse(analyze.competitor_example(benchmark["rows"][2])["signal_valid"])

    def test_invalid_score_alone_cannot_create_a_popularity_gap(self):
        benchmark = analyze.competitor_benchmarks([
            competitor(signal_score_0_100=103, trend_score_12w_pct=0),
        ])
        self.assertIsNone(benchmark[("Permanent Color", "Blonde")]["comp_signal"])
        self.assertEqual(analyze.assortment_gaps([], benchmark, as_of=AS_OF), [])

    def test_trend_only_gap_is_explicit_about_missing_popularity(self):
        benchmark = analyze.competitor_benchmarks([
            competitor(signal_score_0_100=103, trend_score_12w_pct=0.40),
        ])
        gap = analyze.assortment_gaps([], benchmark, as_of=AS_OF)[0]
        self.assertIsNone(gap["competitor_signal_0_100"])
        self.assertIsNone(gap["gap_score"])
        self.assertEqual(gap["valid_signal_rows"], 0)
        self.assertIn("unavailable", gap["rationale"])
        self.assertIsNone(gap["scenario"]["value_eur"])

    def test_out_of_stock_does_not_erase_existing_assortment_coverage(self):
        benchmark = analyze.competitor_benchmarks([competitor()])
        population = [
            sku(product_id="P1", stock_status="out_of_stock"),
            sku(product_id="P2", stock_status="out_of_stock"),
        ]
        self.assertEqual(analyze.assortment_gaps(population, benchmark, as_of=AS_OF), [])

    def test_single_existing_oos_product_requires_supply_check(self):
        benchmark = analyze.competitor_benchmarks([competitor()])
        gap = analyze.assortment_gaps([sku(stock_status="out_of_stock")], benchmark, as_of=AS_OF)[0]
        self.assertEqual(gap["active_skus_held"], 1)
        self.assertEqual(gap["available_skus_held"], 0)
        self.assertIn("Check availability", gap["next_step"])

    def test_inactive_coverage_is_visible_before_new_sourcing(self):
        benchmark = analyze.competitor_benchmarks([competitor()])
        gap = analyze.assortment_gaps([sku(status="inaktiv")], benchmark, as_of=AS_OF)[0]
        self.assertEqual(gap["existing_product_ids"], ["SUBJECT"])
        self.assertIn("existing inactive", gap["next_step"])
        self.assertEqual(gap["source_refs"][0]["record_id"], "COMP-1")
        self.assertEqual(gap["source_refs"][1]["record_id"], "SUBJECT")

    def test_gap_identifiers_and_order_are_stable(self):
        observations = [competitor(), competitor(
            competitor_product_id="COMP-2", subcategory="Toner / Gloss", shade_group="Copper",
        )]
        first = analyze.assortment_gaps([], analyze.competitor_benchmarks(observations), as_of=AS_OF)
        second = analyze.assortment_gaps([], analyze.competitor_benchmarks(list(reversed(observations))), as_of=AS_OF)
        self.assertEqual(first, second)
        self.assertEqual(len({gap["id"] for gap in first}), len(first))


class TestLoading(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name)
        for filename in analyze.INPUT_FILES:
            shutil.copyfile(Path(analyze.BASE) / filename, self.base / filename)

    def mutate(self, filename, change):
        path = self.base / filename
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            fields, rows = reader.fieldnames, list(reader)
        change(rows, fields)
        with path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)

    def test_duplicate_ids_are_rejected(self):
        self.mutate("sku_performance.csv", lambda rows, _: rows.append(dict(rows[0])))
        with self.assertRaisesRegex(ValueError, "duplicate product_id"):
            analyze.load(self.base)

    def test_missing_metadata_is_rejected(self):
        self.mutate("product_metadata.csv", lambda rows, _: rows.pop(0))
        with self.assertRaisesRegex(ValueError, "missing product IDs"):
            analyze.load(self.base)

    def test_bad_numeric_input_has_field_and_source_context(self):
        self.mutate("sku_performance.csv", lambda rows, _: rows[0].update(price_eur="not known"))
        with self.assertRaisesRegex(ValueError, r"sku_performance.csv:2: invalid price_eur"):
            analyze.load(self.base)

    def test_unknown_stock_status_is_not_treated_as_in_stock(self):
        self.mutate("sku_performance.csv", lambda rows, _: rows[0].update(stock_status="maybe"))
        with self.assertRaisesRegex(ValueError, "unknown stock_status"):
            analyze.load(self.base)

    def test_margin_range_is_validated(self):
        self.mutate("sku_performance.csv", lambda rows, _: rows[0].update(channel_margin_pct="35"))
        with self.assertRaisesRegex(ValueError, "out-of-range channel_margin_pct"):
            analyze.load(self.base)

    def test_invalid_date_is_rejected(self):
        self.mutate("competitor_market_signals.csv", lambda rows, _: rows[0].update(observed_date="2026-99-01"))
        with self.assertRaisesRegex(ValueError, "invalid observed_date"):
            analyze.load(self.base)

    def test_missing_header_is_rejected(self):
        def drop_status(rows, fields):
            fields.remove("status")
            for row in rows:
                row.pop("status")
        self.mutate("sku_performance.csv", drop_status)
        with self.assertRaisesRegex(ValueError, "missing columns: status"):
            analyze.load(self.base)

    def test_empty_input_is_not_a_successful_empty_report(self):
        self.mutate("sku_performance.csv", lambda rows, _: rows.clear())
        with self.assertRaisesRegex(ValueError, "no products to review"):
            analyze.load(self.base)

    def test_generated_date_is_not_competitor_observation_date(self):
        payload = analyze.build_review(AS_OF, self.base)
        self.assertEqual(payload["generated"], "2026-09-20")
        self.assertEqual(payload["data_quality"]["competitor_observed_to"], "2026-07-01")
        self.assertEqual(payload["data_quality"]["competitor_age_days"], 81)

    def test_snapshot_changes_for_source_or_rule_configuration(self):
        before = analyze.build_review(AS_OF, self.base)["snapshot_id"]
        self.mutate("sku_performance.csv", lambda rows, _: rows[0].update(price_eur="99"))
        after = analyze.build_review(AS_OF, self.base)["snapshot_id"]
        self.assertNotEqual(before, after)
        with patch.dict(analyze.CFG, {"promote_min_mkt_trend": 0.10}):
            configured = analyze.build_review(AS_OF, self.base)["snapshot_id"]
        self.assertNotEqual(after, configured)
        self.assertEqual(after, analyze.build_review(date(2026, 9, 21), self.base)["snapshot_id"])


class TestDatasetDecisions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = analyze.build_review(AS_OF)
        cls.by_id = {row["product_id"]: row for row in cls.payload["opportunities"]}

    def test_previously_missed_zero_sales_and_inactive_demand(self):
        self.assertEqual(self.by_id["HC0002"]["primary_action"], "Investigate zero sales")
        self.assertEqual(self.by_id["HC0003"]["primary_action"], "Review reactivation")
        self.assertIsNone(self.by_id["HC0002"]["scenario"]["value_eur"])
        self.assertIsNone(self.by_id["HC0003"]["scenario"]["value_eur"])

    def test_all_stock_issues_remain_visible_as_operational_priorities(self):
        summary = self.payload["summary"]
        self.assertEqual(summary["availability_out_of_stock"], 9)
        self.assertEqual(summary["availability_low_stock"], 24)
        for pid in ("HC0043", "HC0053"):
            self.assertEqual(self.by_id[pid]["primary_action"], "Fix availability")
            self.assertIn("Review margin", self.by_id[pid]["also_flagged"])

    def test_lifecycle_actions_do_not_promise_automatic_clearance(self):
        for item in self.by_id.values():
            if item["status"] == "inaktiv":
                self.assertIn(item["primary_action"], {"Review reactivation", "Confirm exit"})
                self.assertIsNone(item["scenario"]["value_eur"])
                self.assertEqual(item["evidence_strength"], "Needs context")

    def test_invalid_scores_are_reported_with_raw_ids_and_values(self):
        quality = self.payload["data_quality"]
        self.assertEqual(quality["invalid_signal_count"], 4)
        self.assertEqual(
            {row["record_id"] for row in quality["exclusions"]},
            {"CM014", "CM044", "CM051", "CM056"},
        )
        for gap in self.payload["assortment_gaps"]:
            value = gap["competitor_signal_0_100"]
            self.assertTrue(value is None or 0 <= value <= 100)

    def test_five_concrete_recommendations_reference_real_decisions(self):
        recommendations = self.payload["recommendations"]
        self.assertEqual(len(recommendations), 5)
        self.assertEqual(len({row["id"] for row in recommendations}), 5)
        for row in recommendations:
            self.assertIn(row["product_id"], row["title"])
            self.assertTrue(row["source_refs"])
            self.assertTrue(row["next_step"])
            self.assertTrue(row["success_measure"])
            self.assertEqual(row, self.by_id[row["product_id"]])

    def test_no_recommendations_are_fabricated_for_empty_groups(self):
        self.assertEqual(analyze.recommendations([], []), [])
        one = self.payload["opportunities"][:1]
        self.assertEqual(analyze.recommendations(one, []), one)

    def test_financial_scenario_totals_are_separate_and_reconcile(self):
        items = self.payload["opportunities"]
        summary = self.payload["summary"]
        for kind, key in (("Revenue", "revenue_scenario_eur"), ("Gross profit", "gross_profit_scenario_eur")):
            expected = sum(item["scenario"]["value_eur"] or 0 for item in items if item["scenario"]["value_type"] == kind)
            self.assertAlmostEqual(summary[key], round(expected, 2))
        self.assertNotIn("annualized", summary)
        self.assertNotIn("total_upside", summary)

    def test_all_decisions_have_complete_evidence_and_no_probability_badges(self):
        for item in self.payload["opportunities"] + self.payload["assortment_gaps"]:
            with self.subTest(item=item["id"]):
                self.assertNotIn("confidence", item)
                self.assertIn(item["evidence_strength"], {"Snapshot only", "Needs context", "Limited comparison"})
                self.assertTrue(item["evidence_reason"])
                self.assertTrue(item["caveats"])
                self.assertTrue(item["source_refs"])
                self.assertEqual(item["scenario"]["period"], "12 weeks")
                value = item["scenario"]["value_eur"]
                self.assertTrue(value is None or (math.isfinite(value) and value >= 0))

    def test_dashboard_contract_is_complete_for_skus_and_gaps(self):
        common = {
            "id", "kind", "title", "primary_action", "priority_tier", "priority_order",
            "rationale", "next_step", "suggested_owner", "success_measure",
            "evidence_strength", "evidence_reason", "caveats", "source_refs",
            "scenario", "also_flagged", "competitor_examples",
        }
        for item in self.payload["opportunities"] + self.payload["assortment_gaps"]:
            with self.subTest(item=item["id"]):
                self.assertFalse(common - item.keys())
                self.assertIsInstance(item["also_flagged"], list)
                self.assertEqual(set(item["scenario"]), {
                    "value_eur", "value_type", "period", "formula", "assumptions",
                })
                for source in item["source_refs"]:
                    self.assertEqual(set(source), {"file", "record_id", "row_number"})
                for example in item["competitor_examples"]:
                    self.assertFalse({
                        "record_id", "name", "brand", "price_eur", "source", "observed_date",
                        "signal_score_0_100", "signal_valid", "trend_score_12w_pct",
                    } - example.keys())

    def test_every_scenario_recalculates_from_its_displayed_raw_operands(self):
        for item in self.payload["opportunities"]:
            value = item["scenario"]["value_eur"]
            if value is None:
                continue
            with self.subTest(item=item["id"]):
                if item["scenario"]["value_type"] == "Revenue":
                    calculated = max(
                        0, item["market_revenue_eur_12w"] * item["peer_ratio_pct"] / 100
                        - item["channel_revenue_eur_12w"],
                    )
                else:
                    calculated = max(
                        0, item["channel_revenue_eur_12w"]
                        * (item["peer_margin_pct"] - item["channel_margin_pct"]),
                    )
                self.assertAlmostEqual(value, round(calculated, 2))

    def test_source_references_preserve_file_record_and_row(self):
        row = self.by_id["HC0004"]
        self.assertEqual(row["source_refs"][0], {
            "file": "sku_performance.csv", "record_id": "HC0004", "row_number": 5,
        })
        self.assertEqual(row["source_refs"][1]["file"], "product_metadata.csv")
        self.assertEqual(row["source_refs"][1]["record_id"], "HC0004")

    def test_build_is_reproducible_with_explicit_review_date(self):
        self.assertEqual(analyze.build_review(AS_OF), self.payload)


class TestOutputs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = analyze.build_review(AS_OF)

    def test_generated_report_uses_selected_decisions_and_honest_claims(self):
        report = analyze.render_markdown(self.payload)
        for item in self.payload["recommendations"]:
            self.assertIn(item["title"], report)
        self.assertIn("2026-07-01", report)
        self.assertIn("CM044", report)
        self.assertNotIn("execution, not demand", report)
        self.assertNotIn("frees", report)
        self.assertNotIn("High confidence", report)

    def test_csv_formula_text_is_neutralised_but_numbers_stay_numeric(self):
        for text in ("=1+1", "+cmd", "-cmd", "@SUM(A1)", "  =1+1", "\t=1+1"):
            self.assertTrue(analyze.csv_cell(text).startswith("'"))
        self.assertEqual(analyze.csv_cell(-0.25), -0.25)
        self.assertEqual(analyze.csv_cell(0), 0)
        self.assertIsNone(analyze.csv_cell(None))
        self.assertEqual(analyze.csv_cell("ordinary text"), "ordinary text")

    def test_csv_round_trip_retains_unicode_commas_quotes_newlines_and_zero(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "export.csv"
            rows = [{"name": 'Crème, "colour"\r\nnext', "value": 0, "unknown": None}]
            analyze.write_csv(path, rows, ["name", "value", "unknown"])
            self.assertTrue(path.read_bytes().startswith(b"\xef\xbb\xbf"))
            with path.open(encoding="utf-8-sig", newline="") as stream:
                saved = list(csv.DictReader(stream))[0]
            self.assertEqual(saved["name"], rows[0]["name"])
            self.assertEqual(saved["value"], "0")
            self.assertEqual(saved["unknown"], "")

    def test_inline_json_cannot_close_script(self):
        payload = copy.deepcopy(self.payload)
        payload["recommendations"][0]["title"] = "</script><script>alert('unsafe')</script>&\u2028"
        html = analyze.render_dashboard(payload)
        self.assertNotIn("</script><script>alert", html)
        self.assertIn(r"\u003c/script\u003e", html)
        self.assertNotIn("__DATA__", html)

    def test_nonfinite_payload_is_rejected(self):
        with self.assertRaises(ValueError):
            analyze.render_dashboard({"not_valid": float("nan")})

    def test_architecture_is_embedded_offline_and_explicitly_not_deployed(self):
        architecture = analyze.load_architecture()
        self.assertIn("not deployed", architecture["status"])
        self.assertTrue(architecture["diagram_data_uri"].startswith("data:image/svg+xml;base64,"))
        self.assertTrue(architecture["mermaid_source"].startswith("flowchart"))
        self.assertIn("Azure App Service", architecture["mermaid_source"])
        self.assertIn("PostgreSQL", architecture["mermaid_source"])
        self.assertIn("Container Apps Jobs", architecture["mermaid_source"])
        self.assertIn("browser", architecture["today"])
        html = analyze.render_dashboard(self.payload)
        self.assertIn('id="open-architecture"', html)
        self.assertIn('id="architecture-dialog"', html)
        self.assertIn("data:image/svg+xml;base64,", html)
        self.assertNotIn('src="https://', html)

    def test_changed_mermaid_source_cannot_silently_keep_an_old_preview(self):
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / "architecture"
            shutil.copytree(Path(analyze.BASE) / "architecture", destination)
            with (destination / "production.mmd").open("a", encoding="utf-8") as stream:
                stream.write("\n%% source changed\n")
            with patch.object(analyze, "BASE", folder):
                with self.assertRaisesRegex(ValueError, "Architecture source or artwork changed"):
                    analyze.load_architecture()

    def test_pipeline_outputs_share_the_same_evidence_without_touching_inputs(self):
        before = {name: hashlib.sha256((Path(analyze.BASE) / name).read_bytes()).hexdigest() for name in analyze.INPUT_FILES}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            outputs = root / "outputs"
            analyze.write_outputs(self.payload, outputs, root)
            self.assertEqual((root / "index.html").read_bytes(), (outputs / "dashboard.html").read_bytes())
            self.assertEqual(json.loads((outputs / "review.json").read_text(encoding="utf-8")), self.payload)
            with (outputs / "opportunities.csv").open(encoding="utf-8-sig", newline="") as stream:
                rows = list(csv.DictReader(stream))
            self.assertEqual(len(rows), self.payload["summary"]["n_flagged"])
            item = next(row for row in rows if row["product_id"] == "HC0003")
            self.assertEqual(item["primary_action"], "Review reactivation")
            self.assertEqual(item["scenario_value_eur"], "")
            self.assertEqual(item["scenario_type"], "Not estimated")
            self.assertEqual(json.loads(item["source_refs"])[0]["record_id"], "HC0003")
        after = {name: hashlib.sha256((Path(analyze.BASE) / name).read_bytes()).hexdigest() for name in analyze.INPUT_FILES}
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main(verbosity=2)
