"use strict";

const assert = require("node:assert/strict");

const RESPONSE_GROUPS = [
  {
    key: "operations", name: "Operational validation",
    actions: ["Fix availability", "Investigate zero sales"],
  },
  {
    key: "range", name: "Range decisions",
    actions: ["Review reactivation", "Confirm exit", "Review seasonal range", "Review delist / markdown"],
  },
  {
    key: "commercial", name: "Commercial review / testing",
    actions: ["Review margin", "Test promotion", "Review price benchmark"],
  },
];

function economics(items, valueType) {
  const cases = items.filter(item => item.scenario.value_type === valueType && item.scenario.value_eur !== null);
  for (const item of cases) {
    assert(Number.isFinite(item.scenario.value_eur) && item.scenario.value_eur >= 0,
      `Invalid ${valueType} scenario for ${item.id}`);
  }
  return {
    value_type: valueType,
    value_eur: Math.round(cases.reduce((sum, item) => sum + item.scenario.value_eur, 0) * 100) / 100,
    case_count: cases.length,
    case_ids: cases.map(item => item.product_id),
  };
}

module.exports = function deriveStrategyMetrics(review) {
  const items = review.opportunities;
  const selected = review.recommendations;
  const byId = new Map(items.map(item => [item.id, item]));
  assert.equal(byId.size, items.length, "A SKU must only appear once in the primary-action queue.");
  assert.equal(items.length, review.summary.n_flagged);
  assert(review.summary.n_skus >= items.length);
  assert.equal(new Set(selected.map(item => item.id)).size, selected.length);
  selected.forEach(item => assert.deepEqual(item, byId.get(item.id),
    "Shortlist economics must use the exact same records as the underlying queue."));
  const responses = RESPONSE_GROUPS.map(group => {
    const cases = items.filter(item => group.actions.includes(item.primary_action));
    return {
      ...group, count: cases.length,
      share_of_flagged_pct: items.length ? cases.length / items.length * 100 : 0,
      case_ids: cases.map(item => item.product_id),
    };
  });
  assert.equal(responses.reduce((sum, group) => sum + group.count, 0), items.length,
    "Every primary action must map to exactly one reviewed management response.");
  const stock = items.filter(item => item.primary_action === "Fix availability");
  const outOfStock = stock.filter(item => item.stock_status === "out_of_stock");
  const financial = ["Revenue", "Gross profit"].map(type => ({
    value_type: type,
    full_queue: economics(items, type),
    shortlist: economics(selected, type),
  }));
  assert.equal(financial[0].full_queue.value_eur, review.summary.revenue_scenario_eur);
  assert.equal(financial[1].full_queue.value_eur, review.summary.gross_profit_scenario_eur);
  return {
    responses,
    no_rule_match: review.summary.n_skus - items.length,
    flagged_pct: items.length / review.summary.n_skus * 100,
    financial,
    shortlist_unquantified: selected.filter(item => item.scenario.value_eur === null).length,
    out_of_stock: {
      count: outOfStock.length,
      historical_channel_revenue_eur: Math.round(outOfStock.reduce(
        (sum, item) => sum + item.channel_revenue_eur_12w, 0) * 100) / 100,
      case_ids: outOfStock.map(item => item.product_id),
    },
  };
};
