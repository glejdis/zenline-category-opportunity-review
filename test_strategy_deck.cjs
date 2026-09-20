"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const derive = require("./presentation/strategy_metrics.cjs");
const snapshot = () => JSON.parse(fs.readFileSync(path.join(__dirname, "outputs", "review.json"), "utf8"));

test("management responses form a complete, mutually exclusive primary-action decomposition", () => {
  const source = snapshot();
  const result = derive(source);
  assert.deepEqual(result.responses.map(group => group.count), [35, 48, 51]);
  const ids = result.responses.flatMap(group => group.case_ids);
  assert.equal(ids.length, 134);
  assert.equal(new Set(ids).size, 134);
  assert.equal(result.no_rule_match, 101);
  assert.equal(ids.length + result.no_rule_match, 235);
  assert.ok(Math.abs(result.responses.reduce((sum, group) => sum + group.share_of_flagged_pct, 0) - 100) < 1e-10);
});

test("shortlist-only financial values are source-backed subsets, never one combined benefit", () => {
  const result = derive(snapshot());
  const [revenue, grossProfit] = result.financial;
  assert.equal(revenue.full_queue.value_eur, 93026.53);
  assert.equal(revenue.shortlist.value_eur, 9986.05);
  assert.equal(revenue.full_queue.case_count, 50);
  assert.deepEqual(revenue.shortlist.case_ids, ["HC0070", "HC0083"]);
  assert.equal(grossProfit.full_queue.value_eur, 24923.66);
  assert.equal(grossProfit.shortlist.value_eur, 4422.43);
  assert.equal(grossProfit.full_queue.case_count, 11);
  assert.deepEqual(grossProfit.shortlist.case_ids, ["HC0024"]);
  assert.equal(result.shortlist_unquantified, 2);
  assert.equal(Object.hasOwn(result, "total_benefit"), false);
  assert.equal(Object.hasOwn(result, "annualized"), false);
  for (const type of result.financial) {
    assert(type.shortlist.case_ids.every(id => type.full_queue.case_ids.includes(id)));
  }
});

test("historical sales on out-of-stock cases are a separate observation, not a lost-sales estimate", () => {
  const result = derive(snapshot());
  assert.equal(result.out_of_stock.count, 9);
  assert.equal(result.out_of_stock.historical_channel_revenue_eur, 61646.14);
  assert.equal(Object.hasOwn(result.out_of_stock, "lost_sales_eur"), false);
});

test("new, unmapped actions fail rather than silently disappearing from the executive exhibit", () => {
  const source = snapshot();
  source.opportunities.find(item => !source.recommendations.some(chosen => chosen.id === item.id)).primary_action = "Unreviewed action";
  assert.throws(() => derive(source), /Every primary action must map/);
});

test("duplicate or altered shortlist records cannot inflate or rewrite its economics", () => {
  const duplicate = snapshot();
  duplicate.recommendations.push(duplicate.recommendations[0]);
  assert.throws(() => derive(duplicate));
  const altered = snapshot();
  altered.recommendations[0].scenario.value_eur += 10;
  assert.throws(() => derive(altered), /exact same records/);
});

test("the source payload is not mutated when deriving executive exhibits", () => {
  const source = snapshot(), before = JSON.stringify(source);
  derive(source);
  assert.equal(JSON.stringify(source), before);
});
