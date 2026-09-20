"use strict";

// Run with: node test_dashboard.cjs
// Uses reusable schema-v2 fixtures, never the generated dashboard or a browser profile.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "dashboard_template.html"), "utf8");
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(match => ({ attributes: match[1], body: match[2] }));
const script = id => {
  const found = scripts.find(item => item.attributes.includes(`id="${id}"`));
  assert.ok(found, `Missing ${id} script`);
  return found.body;
};
const coreScript = script("review-core");
const uiScript = script("review-ui");
const C = new vm.Script(coreScript + "\nCategoryReview;").runInNewContext();
const plain = value => JSON.parse(JSON.stringify(value));

function sku(patch = {}) {
  return {
    id: "sku-HC0004", kind: "sku",
    title: 'Fix availability: Colour "One", Café <demo>',
    primary_action: "Fix availability", priority_tier: "Now", priority_order: 2,
    rationale: "Review availability and sales together; the snapshot does not establish cause.",
    next_step: "Check recent receipts, listing and sell-through before placing an order.",
    suggested_owner: "Category buyer", success_measure: "Document a validated availability decision.",
    evidence_strength: "Snapshot only", evidence_reason: "A single 12-week snapshot.",
    caveats: ["No 12-week period end supplied.", "Product form and pack comparability unverified."],
    source_refs: [
      { file: "sku_performance.csv", record_id: "HC0004", row_number: 5 },
      { file: "product_metadata.csv", record_id: "HC0004", row_number: 5 }
    ],
    scenario: {
      value_eur: 0, value_type: "Revenue", period: "12 weeks",
      formula: "max(0, peer_ratio * market_revenue - channel_revenue)\nNo annualization.",
      assumptions: ["Use the supplied peer group.", "Not a forecast."]
    },
    also_flagged: ["Investigate zero sales", "A future action"],
    competitor_examples: [
      {
        record_id: "COMP0", name: 'Comparator <img src=x onerror="boom()">',
        brand: "Comparator Brand", price_eur: 0, source: "Shop & source",
        observed_date: "2026-01-02", signal_score_0_100: 0, signal_valid: true, trend_score_12w_pct: -0.05
      },
      {
        record_id: "COMP_BAD", name: 'Invalid "score", retained', brand: "Other brand",
        price_eur: 8.75, source: "Shop B", observed_date: "2026-01-03",
        signal_score_0_100: 120, signal_valid: false, trend_score_12w_pct: 0
      }
    ],
    product_id: "HC0004", product_name: 'Colour "One", Café <demo>',
    brand: "Brand A", subcategory: "Permanent", shade_group: "Brown", supplier: "Supplier A",
    private_label: false, status: "Active", stock_status: "Out of stock", seasonality: "All year",
    pack_size: "1 × 100 ml", price_eur: 6.5, channel_revenue_eur_12w: 0, channel_units_12w: 0,
    channel_margin_pct: 0.30125, channel_trend_12w_pct: -0.125,
    market_revenue_eur_12w: 1000, market_trend_12w_pct: 0.0725,
    channel_to_market_ratio_pct: 0, peer_ratio_pct: 4.375, peer_count: 2,
    peer_ids: ["HC0001", "HC0002"], peer_margin_pct: 0.3625,
    comp_benchmark_price_eur: 8.75, competitor_rows: 2, shelf_space_cm: 0,
    ...patch
  };
}

function gap(patch = {}) {
  return {
    id: "gap-abc123", kind: "gap", title: "Validate an assortment follow-up: Permanent / Red",
    primary_action: "Assortment follow-up", priority_tier: "Validate first", priority_order: 8,
    rationale: "Comparator popularity alone does not establish unmet demand.",
    next_step: "Check held SKUs and validate pack-level comparability.",
    suggested_owner: "Range buyer", success_measure: "Record a validated range decision.",
    evidence_strength: "Limited comparison", evidence_reason: "Category and shade comparison only.",
    caveats: ["No competitor supplier inferred."],
    source_refs: [{ file: "competitor_market_signals.csv", record_id: "COMP_BAD", row_number: 3 }],
    scenario: { value_eur: null, value_type: "Not estimated", period: "12 weeks", formula: "Not estimated", assumptions: [] },
    also_flagged: [],
    competitor_examples: sku().competitor_examples,
    subcategory: "Permanent", shade_group: "Red", competitor_signal_0_100: null,
    competitor_trend_12w_pct: 0, competitor_rows: 2, valid_signal_rows: 1,
    active_skus_held: 0, available_skus_held: 0, existing_product_ids: ["HC0099"], gap_score: null,
    ...patch
  };
}

function payload() {
  const first = sku();
  const second = sku({
    id: "sku-HC0005", product_id: "HC0005", product_name: "Seasonal silver", title: "Review margin: Seasonal silver",
    primary_action: "Review margin", priority_tier: "Next", priority_order: 5,
    brand: "Brand B", supplier: "Supplier B", private_label: true, shade_group: "Silver",
    subcategory: "Temporary", channel_revenue_eur_12w: 250,
    scenario: { value_eur: 12.5, value_type: "Gross profit", period: "12 weeks", formula: "250 * 0.05", assumptions: ["Constant revenue."] },
    also_flagged: []
  });
  return {
    schema_version: 2, snapshot_id: "snapshot-one", generated: "2026-09-20",
    architecture: {
      title: "Proposed production architecture",
      status: "Proposed architecture - not deployed",
      scope: "One internal retailer; no resources provisioned.",
      today: "Standalone dashboard and browser-local plan only.",
      flow: ["Validate source inputs before publishing a review."],
      services: [
        { name: "Azure App Service", purpose: "Authenticated dashboard and API", change_needed: "Build the API and enforce scope." },
        { name: "Azure Database for PostgreSQL Flexible Server", purpose: "Shared plans", change_needed: "Replace local storage with approved server persistence." }
      ],
      controls: ["Use managed identity and least privilege."],
      rollout: ["Validate data definitions before piloting."],
      not_required: "No AI inference or Azure OpenAI runtime is required.",
      references: [
        { label: "Official authentication guidance", url: "https://learn.microsoft.com/en-us/azure/app-service/overview-authentication-authorization" }
      ],
      mermaid_source: "flowchart LR\n  APP[Azure App Service] --> DB[PostgreSQL]",
      diagram_svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Proposed only</text></svg>',
      diagram_data_uri: "data:image/svg+xml;base64,PHN2Zy8+"
    },
    data_quality: {
      competitor_observed_from: "2026-01-02", competitor_observed_to: "2026-01-03", competitor_age_days: 260,
      invalid_signal_count: 1, warnings: ["Historical observations; verify freshness."],
      exclusions: [{ file: "competitor_market_signals.csv", record_id: "COMP_BAD", row_number: 3, field: "signal_score_0_100", value: 120, reason: "Outside 0–100" }]
    },
    summary: {
      n_skus: 3, n_flagged: 2, channel_rev: 250, market_rev: 2000, channel_to_market_ratio_pct: 12.5,
      revenue_scenario_eur: 0, gross_profit_scenario_eur: 12.5,
      availability_out_of_stock: 1, availability_low_stock: 0, zero_sales_count: 1, reactivation_count: 0,
      action_counts: { "Fix availability": 1, "Review margin": 1 }
    },
    methodology: { selection: "Priority rules, not monetary ranking.", scenario: "Illustrative, non-causal.", evidence: "Source-linked snapshots." },
    opportunities: [first, second], assortment_gaps: [gap()], recommendations: [first, gap()],
    landscape: [
      {
        id: first.id, product_id: first.product_id, product_name: first.product_name, brand: first.brand, subcategory: first.subcategory,
        market_revenue_eur_12w: 1000, channel_revenue_eur_12w: 0, channel_to_market_ratio_pct: 0,
        primary_action: first.primary_action, scenario_value_eur: 0, scenario_type: "Revenue"
      },
      {
        id: "sku-HC0999", product_id: "HC0999", product_name: "Unflagged product", brand: "Brand C", subcategory: "Permanent",
        market_revenue_eur_12w: 0, channel_revenue_eur_12w: 0, channel_to_market_ratio_pct: null,
        primary_action: "", scenario_value_eur: null, scenario_type: "Not estimated"
      },
      {
        id: "sku-MISSING", product_id: "MISSING", product_name: "No revenue supplied", brand: "Brand C", subcategory: "Permanent",
        market_revenue_eur_12w: null, channel_revenue_eur_12w: 10, channel_to_market_ratio_pct: null,
        primary_action: "", scenario_value_eur: null, scenario_type: "Not estimated"
      }
    ],
    subcategories: [{ subcategory: "Permanent", channel_rev: 0, market_rev: 1000, ratio_pct: 0, n: 2 }]
  };
}

test("all executable inline scripts compile; data has one replaceable marker", () => {
  assert.equal((html.match(/__DATA__/g) || []).length, 1);
  assert.ok(scripts[0].body.includes('new URLSearchParams(window.location.search).get("clawpilotTheme")'));
  for (const [index, item] of scripts.entries()) {
    if (item.attributes.includes('type="application/json"')) continue;
    assert.doesNotThrow(() => new vm.Script(item.body, { filename: `dashboard-inline-${index}.js` }));
  }
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=|<link\b[^>]*rel=["']stylesheet|@import/i);
  assert.doesNotMatch(coreScript + uiScript, /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/);
});

test("Clawpilot colors stay in theme variables, with the required font and subtle shadow", () => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const componentCss = css.replace(/--cp-[\w-]+\s*:[^;]+;/g, "");
  assert.doesNotMatch(componentCss, /#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i);
  assert.ok(css.includes('"Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif'));
  assert.ok(css.includes('Consolas, "Courier New", Courier, monospace'));
  for (const variable of ["bg", "bg-elevated", "surface", "surface-soft", "border", "border-strong", "text", "text-muted", "text-soft", "accent", "accent-hover", "accent-soft", "accent-fg", "success", "danger", "warning", "link", "shadow", "overlay", "panel", "panel-strong", "sheen", "highlight"]) {
    assert.equal((css.match(new RegExp(`--cp-${variable}:`, "g")) || []).length, 2, variable);
  }
  assert.ok(css.includes("--cp-card-shadow: 0 0 2px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.14)"));
});

test("CSV quotes commas, CR, LF and quotes and starts with a UTF-8 BOM", () => {
  const value = 'Café, "quoted"\nsecond\rthird\r\nfourth';
  assert.equal(C.csvCell(value), '"Café, ""quoted""\nsecond\rthird\r\nfourth"');
  const result = C.csv([["value", "Header"]], [{ value }]);
  assert.equal(result, '\ufeff"Header"\r\n"Café, ""quoted""\nsecond\rthird\r\nfourth"\r\n');
  assert.equal(Buffer.from(result, "utf8").subarray(0, 3).toString("hex"), "efbbbf");
});

test("CSV neutralizes formula-leading text including whitespace, without changing negative numbers or zero", () => {
  for (const value of ["=SUM(A1)", "+12", "-12", "@lookup", " \t=HYPERLINK(\"url\")", "\r\n-2", "\u00a0+5", "\ufeff@A1", "\u200b=1"]) {
    assert.ok(C.csvCell(value).startsWith("\"'"), JSON.stringify(value));
  }
  assert.equal(C.csvCell(-12.5), "-12.5");
  assert.equal(C.csvCell(0), "0");
  assert.equal(C.csvCell(null), "");
  assert.equal(C.csvCell(undefined), "");
  assert.equal(C.csvCell(false), '"false"');
  assert.equal(C.csvCell("0"), '"0"');
  assert.throws(() => C.csvCell(Infinity), /non-finite/);
  assert.equal(C.csv([["a", "a"], ["b", "b"], ["c", "c"], ["d", "d"]], [{ a: -12, b: "-12", c: 0, d: null }]), '\ufeff"a","b","c","d"\r\n-12,"\'-12",0,\r\n');
});

test("null and zero remain distinct in display and scenario labels", () => {
  assert.equal(C.number(null), "Not supplied");
  assert.equal(C.number(0), "0");
  assert.equal(C.percent(0), "0%");
  assert.equal(C.euros(0), "€0.00");
  assert.equal(C.scenarioLabel(sku().scenario), "Revenue · €0.00 · 12 weeks");
  assert.equal(C.scenarioLabel(gap().scenario), "Not estimated");
  assert.equal(C.scenarioLabel({ value_type: "Gross profit", value_eur: 20, period: "12 weeks" }), "Gross profit · €20.00 · 12 weeks");
});

test("fractional source rates and derived percentage-point ratios use different formatters", () => {
  assert.equal(C.fractionPercent(0.325), "32.5%");
  assert.equal(C.fractionPercent(-0.125), "-12.5%");
  assert.equal(C.fractionPercent(0), "0%");
  assert.equal(C.fractionPercent(null), "Not supplied");
  assert.equal(C.percent(6.291360581808698), "6.291%");
  assert.equal(C.percent(0.5), "0.5%");
  assert.equal(C.fractionPercent(0.5), "50%");
});

test("review plan adds independent saved evidence once and permits only user-editable fields", () => {
  const item = sku();
  const original = C.emptyPlan("snapshot-one");
  let plan = C.addToPlan(original, item);
  assert.equal(original.entries.length, 0);
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].owner, "Category buyer");
  assert.equal(plan.entries[0].decision, "To review");
  assert.equal(C.addToPlan(plan, item), plan);
  item.next_step = "Mutated upstream";
  assert.notEqual(plan.entries[0].source_item.next_step, item.next_step);
  plan = C.editPlanEntry(plan, item.id, { owner: "", due_date: "2026-10-01", decision: "Deferred", status: "In progress", notes: 'A note with <script>text</script>\n"quotes"', selected: false });
  const entry = plan.entries[0];
  assert.equal(entry.owner, "");
  assert.equal(entry.decision, "Deferred");
  assert.equal(entry.status, "In progress");
  assert.equal(entry.selected, false);
  assert.ok(entry.notes.includes("<script>"));
  assert.throws(() => C.editPlanEntry(plan, item.id, { id: "changed" }), /not editable/);
  assert.throws(() => C.editPlanEntry(plan, item.id, { decision: "Ordered" }), /Unknown decision/);
  assert.throws(() => C.editPlanEntry(plan, item.id, { status: "Assigned" }), /Unknown workflow/);
  assert.throws(() => C.editPlanEntry(plan, item.id, { notes: 1 }), /Invalid plan/);
  assert.throws(() => C.editPlanEntry(plan, item.id, { due_date: "tomorrow" }), /complete due date/);
  assert.equal(C.removeFromPlan(plan, item.id).entries.length, 0);
  assert.equal(plan.entries.length, 1);
});

test("valid plans survive reload and regeneration with the same review snapshot", () => {
  const item = sku();
  let plan = C.addToPlan(C.emptyPlan("snapshot-one"), item);
  plan = C.editPlanEntry(plan, item.id, { notes: "User work", decision: "Accepted", owner: "Local reviewer" });
  const raw = JSON.stringify(plan);
  const restored = C.loadPlan(() => raw, "snapshot-one", [item]);
  assert.equal(restored.canPersist, true);
  assert.equal(restored.warning, "");
  assert.deepEqual(plain(restored.plan), plain(plan));
  assert.equal(restored.plan.entries[0].revalidation_required, false);
});

test("plan dates must be real calendar dates; invalid saved dates stay preserved", () => {
  const plan = C.addToPlan(C.emptyPlan("snapshot-one"), sku());
  for (const invalid of ["2026-02-29", "2026-02-31", "2026-13-01", "0000-01-01", "tomorrow"]) {
    assert.throws(() => C.editPlanEntry(plan, sku().id, { due_date: invalid }), /valid calendar day/);
    const raw = JSON.stringify({ ...plain(plan), entries: [{ ...plain(plan.entries[0]), due_date: invalid }] });
    const restored = C.loadPlan(() => raw, "snapshot-one", [sku()]);
    assert.equal(restored.canPersist, false);
    assert.equal(restored.raw, raw);
  }
  assert.equal(C.editPlanEntry(plan, sku().id, { due_date: "2024-02-29" }).entries[0].due_date, "2024-02-29");
});
test("changed snapshots and removed items preserve all edits and evidence until explicit acknowledgement", () => {
  const first = sku();
  const removed = gap();
  let plan = C.addToPlan(C.addToPlan(C.emptyPlan("snapshot-one"), first), removed);
  plan = C.editPlanEntry(plan, first.id, { owner: "My owner", notes: "Keep this", decision: "Accepted", status: "Done", due_date: "2026-10-01", selected: false });
  const current = sku({ next_step: "New snapshot next step", scenario: { ...first.scenario, value_eur: 20 } });
  let refreshed = C.loadPlan(() => JSON.stringify(plan), "snapshot-two", [current]).plan;
  const retained = refreshed.entries[0];
  assert.equal(refreshed.snapshot_id, "snapshot-two");
  assert.equal(retained.revalidation_required, true);
  assert.equal(retained.unavailable, false);
  assert.equal(retained.source_snapshot_id, "snapshot-one");
  assert.equal(retained.source_item.next_step, first.next_step);
  assert.equal(refreshed.entries[1].unavailable, true);
  assert.equal(refreshed.entries[1].revalidation_required, true);
  assert.throws(() => C.acknowledgeEntry(refreshed, removed.id, [current]), /unavailable/);
  refreshed = C.acknowledgeEntry(refreshed, first.id, [current]);
  assert.equal(refreshed.entries[0].revalidation_required, false);
  assert.equal(refreshed.entries[0].source_snapshot_id, "snapshot-two");
  assert.equal(refreshed.entries[0].added_snapshot_id, "snapshot-one");
  assert.equal(refreshed.entries[0].source_item.next_step, current.next_step);
  for (const key of ["owner", "notes", "decision", "status", "due_date", "selected"]) assert.equal(refreshed.entries[0][key], plan.entries[0][key]);
  const reappeared = C.reconcilePlan(refreshed, "snapshot-two", [current, removed]);
  assert.equal(reappeared.entries[1].unavailable, false);
  assert.equal(reappeared.entries[1].revalidation_required, true);
  assert.equal(C.addToPlan(reappeared, removed).entries.length, 2);
});

test("even a missing item within an unchanged snapshot requires manual revalidation when it returns", () => {
  const item = sku();
  const plan = C.addToPlan(C.emptyPlan("snapshot-one"), item);
  const missing = C.reconcilePlan(plan, "snapshot-one", []);
  const returned = C.reconcilePlan(missing, "snapshot-one", [item]);
  assert.equal(returned.entries[0].unavailable, false);
  assert.equal(returned.entries[0].revalidation_required, true);
  assert.equal(C.acknowledgeEntry(returned, item.id, [item]).entries[0].revalidation_required, false);
});

test("a changed suggested action with the same review snapshot never silently remaps the saved plan", () => {
  for (const original of [sku(), gap()]) {
    let plan = C.addToPlan(C.emptyPlan("snapshot-one"), original);
    plan = C.editPlanEntry(plan, original.id, { owner: "My owner", notes: "Keep my original decision", decision: "Accepted", status: "Done", due_date: "2026-10-01" });
    const current = {
      ...original,
      primary_action: "A newly supplied action label",
      title: "A different suggested decision for the same item",
      next_step: "Different next step requiring review."
    };
    let restored = C.loadPlan(() => JSON.stringify(plan), "snapshot-one", [current]).plan;
    assert.equal(restored.entries[0].revalidation_required, true);
    assert.equal(restored.entries[0].unavailable, false);
    assert.equal(restored.entries[0].title, original.title);
    assert.equal(restored.entries[0].source_item.primary_action, original.primary_action);
    assert.equal(restored.entries[0].source_item.next_step, original.next_step);
    assert.equal(C.addToPlan(restored, current), restored);
    const exported = C.exportPlanRows(restored)[0];
    assert.equal(exported.primary_action, original.primary_action);
    assert.equal(exported.revalidation_required, true);
    assert.equal(exported.current_snapshot_id, exported.source_snapshot_id);
    assert.equal(C.reconcilePlan(restored, "snapshot-one", [original]).entries[0].revalidation_required, true);
    restored = C.acknowledgeEntry(restored, original.id, [current]);
    assert.equal(restored.entries[0].revalidation_required, false);
    assert.equal(restored.entries[0].title, current.title);
    assert.equal(restored.entries[0].source_item.primary_action, current.primary_action);
    for (const key of ["owner", "notes", "decision", "status", "due_date", "selected"]) assert.equal(restored.entries[0][key], plan.entries[0][key]);
  }
});

test("corrupt, unknown-version, malformed and duplicate saved data are preserved rather than overwritten", () => {
  const valid = C.addToPlan(C.emptyPlan("snapshot-one"), sku());
  const bad = [
    "{broken", "",
    JSON.stringify({ version: 999, snapshot_id: "old", entries: [{ notes: "Do not discard" }] }),
    JSON.stringify({ ...plain(valid), entries: [...plain(valid.entries), ...plain(valid.entries)] }),
    JSON.stringify({ ...plain(valid), entries: [{ ...plain(valid.entries[0]), status: "Unsupported" }] }),
    JSON.stringify({ ...plain(valid), entries: [{ ...plain(valid.entries[0]), source_item: null }] }),
    JSON.stringify({ ...plain(valid), entries: [{ ...plain(valid.entries[0]), source_item: { ...sku(), caveats: "not an array" } }] }),
    JSON.stringify({ ...plain(valid), entries: [{ ...plain(valid.entries[0]), source_item: { ...sku(), competitor_examples: [null] } }] }),
    JSON.stringify({ ...plain(valid), entries: [{ ...plain(valid.entries[0]), source_item: { ...sku(), scenario: { ...sku().scenario, assumptions: {} } } }] })
  ];
  for (const raw of bad) {
    const restored = C.loadPlan(() => raw, "snapshot-two", [sku()]);
    assert.equal(restored.canPersist, false);
    assert.equal(restored.raw, raw);
    assert.match(restored.warning, /left untouched/);
    assert.equal(restored.plan.entries.length, 0);
    const memoryPlan = C.addToPlan(restored.plan, sku());
    assert.equal(memoryPlan.entries.length, 1);
    assert.equal(restored.raw, raw);
  }
});

test("storage unavailable, quota failure and concurrent writes return explicit non-persisted states", () => {
  const item = sku();
  const unavailable = C.loadPlan(() => { throw new Error("SecurityError"); }, "snapshot-one", [item]);
  assert.equal(unavailable.canPersist, false);
  assert.match(unavailable.warning, /memory only/);
  const plan = C.addToPlan(C.emptyPlan("snapshot-one"), item);
  let saved = null;
  const result = C.savePlan(() => saved, raw => { saved = raw; }, plan, null);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(saved), plain(plan));
  const originalRaw = saved;
  const quota = C.savePlan(() => saved, () => { throw new Error("QuotaExceededError"); }, plan, saved);
  assert.equal(quota.ok, false);
  assert.equal(saved, originalRaw);
  assert.match(quota.warning, /unavailable or full/);
  let writes = 0;
  const concurrent = C.savePlan(() => "other tab's work", () => { writes++; }, plan, originalRaw);
  assert.equal(concurrent.ok, false);
  assert.equal(writes, 0);
  assert.equal(concurrent.raw, "other tab's work");
  assert.match(concurrent.warning, /not overwritten/);
});

test("plan CSV includes only selected entries and the saved, stale source metadata with typed numbers", () => {
  let plan = C.addToPlan(C.addToPlan(C.emptyPlan("snapshot-one"), sku()), gap());
  plan = C.editPlanEntry(plan, "sku-HC0004", { notes: " \t=SUM(A1)\nDo not execute", owner: "-local owner" });
  plan = C.editPlanEntry(plan, "gap-abc123", { selected: false });
  plan = C.reconcilePlan(plan, "snapshot-two", []);
  const rows = C.exportPlanRows(plan);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "sku-HC0004");
  assert.equal(rows[0].source_snapshot_id, "snapshot-one");
  assert.equal(rows[0].current_snapshot_id, "snapshot-two");
  assert.equal(rows[0].revalidation_required, true);
  assert.equal(rows[0].unavailable, true);
  assert.equal(rows[0].scenario_value_eur, 0);
  assert.equal(typeof rows[0].scenario_value_eur, "number");
  assert.equal(rows[0].scenario_type, "Revenue");
  assert.equal(rows[0].scenario_period, "12 weeks");
  assert.match(rows[0].source_refs, /sku_performance\.csv/);
  assert.equal(rows[0].next_step, sku().next_step);
  const result = C.csv(C.PLAN_COLUMNS, rows);
  assert.ok(result.includes('"\' \t=SUM(A1)\nDo not execute"'));
  assert.ok(result.includes("\"'-local owner\""));
  assert.equal(C.exportPlanRows(C.selectPlanEntries(plan, false)).length, 0);
  assert.equal(C.exportPlanRows(C.selectPlanEntries(plan, true)).length, 2);
});

test("SKU and gap CSV exports preserve negative metrics, zero and absent estimates separately", () => {
  const skuRows = C.exportItemRows([sku()], "snapshot-one");
  assert.equal(skuRows[0].channel_trend_12w_pct, -0.125);
  assert.equal(skuRows[0].channel_revenue_eur_12w, 0);
  assert.equal(skuRows[0].scenario_value_eur, 0);
  assert.equal(skuRows[0].snapshot_id, "snapshot-one");
  assert.equal(skuRows[0].peer_ids, "HC0001\nHC0002");
  assert.ok(C.csv(C.SKU_COLUMNS, skuRows).includes(",-0.125,"));
  const gapRows = C.exportItemRows([gap()], "snapshot-one");
  assert.equal(gapRows[0].scenario_value_eur, null);
  assert.equal(gapRows[0].competitor_signal_0_100, null);
  assert.equal(gapRows[0].active_skus_held, 0);
});

test("combined filters support dynamic primary and secondary actions, case-insensitive text, ownership and source order", () => {
  const first = sku();
  const second = sku({ id: "sku-HC0005", product_id: "HC0005", private_label: true, priority_order: 1, brand: "Brand B", supplier: "Supplier B" });
  const filters = { subcategory: "Permanent", brand: "Brand A", supplier: "Supplier A", privateLabel: "false", action: "A future action", search: "  hc0004 " };
  assert.deepEqual(C.filterItems([second, first], filters).map(item => item.id), ["sku-HC0004"]);
  assert.equal(C.filterItems([first], { ...filters, privateLabel: "true" }).length, 0);
  assert.equal(C.filterItems([first], { ...filters, supplier: "Other" }).length, 0);
  assert.equal(C.filterItems([first], { action: "Never supplied" }).length, 0);
  assert.equal(C.filterItems([first], { search: "COMPARATOR BRAND" }).length, 1);
  assert.deepEqual(C.filterItems([first, second], {}).map(item => item.id), ["sku-HC0005", "sku-HC0004"]);
  const tied = [sku({ id: "first", priority_order: 1 }), sku({ id: "second", priority_order: 1 }), sku({ id: "last", priority_order: null })];
  assert.deepEqual(C.sortItems(tied).map(item => item.id), ["first", "second", "last"]);
});

test("assortment filters intentionally ignore SKU-only brand, supplier and ownership", () => {
  const item = gap();
  assert.equal(C.filterItems([item], { subcategory: "Permanent", brand: "Unrelated", supplier: "Unknown", privateLabel: "true", action: "Assortment follow-up", search: "red" }).length, 1);
  assert.equal(C.filterItems([item], { subcategory: "Temporary" }).length, 0);
  assert.equal(C.filterItems([item], { action: "Fix availability" }).length, 0);
});

test("SKU evidence exposes every measured field, exact formula and source references", () => {
  const item = sku();
  const model = C.evidenceModel(item);
  const rows = new Map(model.measured);
  const expected = {
    "Product ID": "HC0004", "Product name": item.product_name, "Brand": "Brand A",
    "Subcategory": "Permanent", "Shade group": "Brown", "Supplier": "Supplier A", "Private label": "No",
    "Lifecycle status": "Active", "Stock status": "Out of stock", "Seasonality": "All year", "Pack size": "1 × 100 ml",
    "Shelf space · cm": "0", "Selling price": "€6.50", "Channel revenue · 12 weeks": "€0.00",
    "Channel units · 12 weeks": "0", "Channel margin": "30.125%", "Channel trend · 12 weeks": "-12.5%",
    "Market proxy revenue · 12 weeks": "€1,000.00", "Market trend · 12 weeks": "7.25%",
    "Channel-to-market revenue ratio": "0%", "Peer channel-to-market ratio": "4.375%",
    "Peer group count": "2", "Peer product IDs": "HC0001, HC0002", "Peer margin": "36.25%",
    "Competitor price benchmark": "€8.75", "Comparator row count": "2"
  };
  assert.equal(rows.size, Object.keys(expected).length);
  for (const [label, value] of Object.entries(expected)) assert.equal(rows.get(label), value, label);
  assert.equal(new Map(model.scenario).get("Exact supplied formula"), item.scenario.formula);
  assert.equal(new Map(model.scenario).get("Illustrative scenario value"), "€0.00");
  assert.deepEqual(plain(model.sources), [["sku_performance.csv", "HC0004", "5"], ["product_metadata.csv", "HC0004", "5"]]);
  assert.deepEqual(plain(model.assumptions), item.scenario.assumptions);
  assert.deepEqual(plain(model.caveats), item.caveats);
});

test("gap evidence contains held and available counts without inventing a supplier; invalid raw popularity stays visible", () => {
  const model = C.evidenceModel(gap());
  const rows = new Map(model.measured);
  assert.equal(rows.get("Active SKUs held"), "0");
  assert.equal(rows.get("Available SKUs held"), "0");
  assert.equal(rows.get("Existing product IDs"), "HC0099");
  assert.equal(rows.get("Competitor popularity signal · 0–100"), "Not supplied");
  assert.equal(rows.get("Gap review score · not predicted sales"), "Not supplied");
  assert.equal(rows.get("Valid popularity row count"), "1");
  assert.equal(rows.has("Supplier"), false);
  assert.equal(model.comparators[0][6], "0");
  assert.equal(model.comparators[0][7], "Included as a popularity signal only");
  assert.equal(model.comparators[0][8], "-5%");
  assert.equal(model.comparators[1][0], "COMP_BAD");
  assert.equal(model.comparators[1][5], "2026-01-03");
  assert.equal(model.comparators[1][6], "120");
  assert.equal(model.comparators[1][7], "EXCLUDED from popularity");
  assert.equal(new Map(model.scenario).get("Illustrative scenario value"), "Not estimated");
});

// Minimal platform stub exercises the actual production DOM renderer and events.
// HTML insertion is deliberately unsupported: source and note strings must stay text.
class Element {
  constructor(tagName, document) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = {};
    this.events = new Map();
    this._text = "";
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this.open = false;
  }
  set id(value) {
    this._id = value;
    this.ownerDocument.ids.set(value, this);
  }
  get id() { return this._id || ""; }
  set textContent(value) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = String(value);
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  set innerHTML(_) { throw new Error("Unsafe HTML insertion"); }
  set outerHTML(_) { throw new Error("Unsafe HTML insertion"); }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.textContent = "";
    this.append(...nodes);
  }
  remove() {
    if (this.parentNode) {
      const siblings = this.parentNode.children;
      const index = siblings.indexOf(this);
      if (index >= 0) siblings.splice(index, 1);
      this.parentNode = null;
    }
  }
  setAttribute(key, value) {
    this.attributes[key] = String(value);
    if (key === "id") this.id = value;
    if (key === "class") this.className = value;
    if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(type, handler) {
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(handler);
  }
  fire(type, properties = {}) {
    const event = {
      type, currentTarget: this, target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...properties
    };
    for (const handler of this.events.get(type) || []) handler(event);
    if (type === "cancel" && this.tagName === "DIALOG" && !event.defaultPrevented) this.close();
    return event;
  }
  click() {
    if (this.disabled) return;
    if (this.tagName === "A") this.ownerDocument.downloads.push({ filename: this.download, url: this.href });
    this.fire("click");
  }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.fire("close"); }
  get isConnected() {
    let current = this;
    while (current) {
      if (current === this.ownerDocument.documentElement) return true;
      current = current.parentNode;
    }
    return false;
  }
}

function boot(options = {}) {
  const document = {
    ids: new Map(), downloads: [], activeElement: null,
    createElement(tag) { return new Element(tag, this); },
    createElementNS(_namespace, tag) { return this.createElement(tag); },
    getElementById(id) {
      const node = this.ids.get(id);
      return node && node.isConnected ? node : null;
    },
    querySelectorAll(selector) {
      const dataKey = selector.match(/^\[data-([\w-]+)\]$/);
      if (!dataKey) throw new Error("Unsupported test selector: " + selector);
      const key = dataKey[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return descendants(this.documentElement).filter(node => Object.hasOwn(node.dataset, key));
    }
  };
  document.documentElement = document.createElement("html");
  document.body = document.createElement("body");
  document.documentElement.append(document.body);
  document.activeElement = document.body;
  const markup = html.slice(0, html.indexOf('<script id="review-data"'));
  for (const match of markup.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)) {
    const node = document.createElement(match[1]);
    node.id = match[2];
    node.hidden = /\bhidden\b/.test(match[0]);
    node.disabled = /\bdisabled\b/.test(match[0]);
    document.body.append(node);
  }
  const embedded = document.createElement("script");
  embedded.id = "review-data";
  embedded.textContent = JSON.stringify(options.data || payload());
  document.body.append(embedded);
  let stored = options.stored === undefined ? null : options.stored;
  const writes = [];
  const blobs = [];
  const timers = [];
  const revoked = [];
  const windowEvents = new Map();
  const window = {
    location: { search: options.themeQuery || "" },
    matchMedia: () => ({ matches: false }),
    localStorage: {
      getItem() {
        if (options.unavailableStorage) throw new Error("SecurityError");
        return stored;
      },
      setItem(_key, value) {
        if (options.quotaFailure) throw new Error("QuotaExceededError");
        stored = value;
        writes.push(value);
      }
    },
    setTimeout(handler, delay) { timers.push({ handler, delay }); return timers.length; },
    addEventListener(type, handler) { windowEvents.set(type, handler); }
  };
  const URL = {
    createObjectURL(blob) {
      if (options.exportFailure) throw new Error("Download blocked");
      blobs.push(blob);
      return "blob:fixture-" + blobs.length;
    },
    revokeObjectURL(url) { revoked.push(url); }
  };
  const context = vm.createContext({ document, window, Blob, URL, URLSearchParams });
  vm.runInContext(scripts[0].body, context);
  vm.runInContext(coreScript, context);
  vm.runInContext(uiScript, context);
  return {
    document, window, writes, blobs, timers, revoked, windowEvents,
    get: id => document.getElementById(id),
    all: tag => descendants(document.documentElement).filter(node => node.tagName === tag.toUpperCase()),
    stored: () => stored
  };
}

function descendants(node) {
  return [node, ...node.children.flatMap(child => descendants(child))];
}

function addFirst(app) {
  const add = app.document.querySelectorAll("[data-add-id]").find(node => node.dataset.addId === "sku-HC0004");
  assert.ok(add);
  add.click();
}

test("real DOM renderer starts with the shortlist, separated dates and honest zero-valued scenarios", () => {
  const app = boot({ themeQuery: "?clawpilotTheme=dark" });
  assert.equal(app.get("app-error").hidden, true, app.get("app-error").textContent);
  assert.equal(app.get("startup-state").hidden, true);
  assert.equal(app.document.documentElement.getAttribute("data-theme"), "dark");
  assert.equal(app.get("headline").textContent, "Start here: 2 decisions for the category review");
  assert.match(app.get("generated-label").textContent, /2026-09-20.*Not an observation date/);
  assert.match(app.get("quality-details").textContent, /2026-01-02/);
  assert.match(app.get("quality-details").textContent, /2026-01-03/);
  assert.match(app.get("quality-details").textContent, /Review snapshot IDsnapshot-one/);
  assert.match(app.get("quality-details").textContent, /source files plus the rule version and configuration/);
  assert.match(app.get("quality-status").textContent, /1.*EXCLUDED/);
  assert.match(app.get("recommendations").textContent, /Revenue · €0\.00 · 12 weeks/);
  assert.match(app.get("snapshot-stats").textContent, /Revenue scenarios · 12 weeks€0\.00/);
  assert.equal(app.get("explorer").open, false);
  assert.equal(app.get("export-plan").disabled, true);
  assert.equal(app.writes.length, 0);
});

test("architecture icon opens an offline proposal without touching the review plan", () => {
  const app = boot();
  const state = app.stored();
  app.get("open-architecture").click();
  assert.equal(app.get("app-error").hidden, true, app.get("app-error").textContent);
  assert.equal(app.get("architecture-dialog").open, true);
  assert.equal(app.document.activeElement, app.get("close-architecture"));
  const body = app.get("architecture-body").textContent;
  assert.match(body, /Proposed architecture - not deployed/);
  assert.match(body, /browser-local plan only/);
  assert.match(body, /Azure App Service/);
  assert.match(body, /Build the API and enforce scope/);
  assert.match(body, /No AI inference/);
  assert.equal(app.all("img").length, 1);
  assert.ok(app.all("img")[0].src.startsWith("data:image/svg+xml;base64,"));
  assert.equal(app.writes.length, 0);
  assert.equal(app.stored(), state);
  const enlarge = descendants(app.get("architecture-body")).find(node => node.tagName === "BUTTON" && node.textContent === "Enlarge diagram");
  enlarge.click();
  assert.equal(enlarge.getAttribute("aria-pressed"), "true");
  assert.equal(enlarge.textContent, "Fit diagram");
  enlarge.click();
  assert.equal(enlarge.getAttribute("aria-pressed"), "false");
  app.get("architecture-dialog").fire("cancel");
  assert.equal(app.get("architecture-dialog").open, false);
  assert.equal(app.document.activeElement, app.get("open-architecture"));
});

test("architecture exports the exact editable Mermaid and static SVG without network requests", async () => {
  const app = boot();
  app.get("open-architecture").click();
  const buttons = descendants(app.get("architecture-body")).filter(node => node.tagName === "BUTTON");
  buttons.find(node => node.textContent === "Download Mermaid source").click();
  buttons.find(node => node.textContent === "Download diagram SVG").click();
  assert.equal(app.document.downloads[0].filename, "azure-production-architecture.mmd");
  assert.equal(app.document.downloads[1].filename, "azure-production-architecture.svg");
  assert.equal(await app.blobs[0].text(), payload().architecture.mermaid_source);
  assert.equal(await app.blobs[1].text(), payload().architecture.diagram_svg);
  assert.equal(app.writes.length, 0);
});

test("missing architecture is an explicit error, not a fictitious Azure deployment", () => {
  const data = payload();
  delete data.architecture;
  const app = boot({ data });
  assert.equal(app.get("app-error").hidden, true);
  app.get("open-architecture").click();
  assert.match(app.get("app-error").textContent, /Architecture content is missing/);
  assert.equal(app.get("architecture-dialog").open, false);
  assert.equal(app.writes.length, 0);
});
test("scenario totals stay explicitly global across flagged primary actions, independently of the shortlist, plan and filters", () => {
  const data = payload();
  const app = boot({ data });
  const initial = app.get("snapshot-stats").textContent;
  assert.match(initial, /Global: all flagged primary actions, not the shortlist, local plan or filtered table/);
  assert.ok(initial.includes("Gross-profit scenarios · 12 weeks" + C.euros(data.summary.gross_profit_scenario_eur)));
  assert.equal(data.recommendations.some(item => item.scenario.value_type === "Gross profit"), false);
  addFirst(app);
  app.get("filter-action").value = data.opportunities[0].primary_action;
  app.get("filter-action").fire("change");
  assert.match(app.get("filter-count").textContent, /1 of 2 SKUs/);
  assert.equal(app.get("snapshot-stats").textContent, initial);
});

test("map dots have constant size even for incomparable revenue and gross-profit scenarios", () => {
  const data = payload();
  const second = data.opportunities[1];
  data.landscape[0].scenario_value_eur = 1000000;
  data.landscape.push({
    id: second.id, product_id: second.product_id, product_name: second.product_name,
    brand: second.brand, subcategory: second.subcategory,
    market_revenue_eur_12w: second.market_revenue_eur_12w,
    channel_revenue_eur_12w: second.channel_revenue_eur_12w,
    channel_to_market_ratio_pct: second.channel_to_market_ratio_pct,
    primary_action: second.primary_action, scenario_value_eur: second.scenario.value_eur,
    scenario_type: "Gross profit"
  });
  const app = boot({ data });
  const dots = app.all("circle");
  assert.equal(dots.length, 3);
  assert.deepEqual([...new Set(dots.map(dot => dot.getAttribute("r")))], ["6"]);
  assert.match(app.get("landscape-note").textContent, /Equal-size dots; monetary scenarios are not encoded by size/);
  assert.equal(app.get("market-context").open, false);
});

test("real evidence renderer keeps source strings as text, shows all metrics and restores keyboard focus", () => {
  const app = boot();
  const view = descendants(app.get("recommendations")).find(node => node.tagName === "BUTTON" && node.textContent === "View evidence");
  view.focus();
  view.click();
  assert.equal(app.get("evidence-dialog").open, true);
  assert.equal(app.document.activeElement, app.get("close-evidence"));
  const rendered = app.get("evidence-body").textContent;
  assert.ok(rendered.includes(sku().product_name));
  assert.ok(rendered.includes(sku().scenario.formula));
  assert.match(rendered, /Stock statusOut of stock/);
  assert.match(rendered, /Lifecycle statusActive/);
  assert.match(rendered, /SeasonalityAll year/);
  assert.match(rendered, /Peer group count2/);
  assert.match(rendered, /Peer product IDsHC0001, HC0002/);
  assert.match(rendered, /Channel revenue · 12 weeks€0\.00/);
  assert.match(rendered, /120EXCLUDED from popularity/);
  assert.ok(rendered.includes(sku().competitor_examples[0].name));
  assert.equal(app.all("img").length, 0);
  app.get("evidence-dialog").fire("cancel");
  assert.equal(app.get("evidence-dialog").open, false);
  assert.equal(app.document.activeElement, view);
});

test("real plan controls deduplicate, auto-save edits, reload notes safely and disable empty exports", () => {
  const app = boot();
  addFirst(app);
  const duplicateButtons = app.document.querySelectorAll("[data-add-id]").filter(node => node.dataset.addId === "sku-HC0004");
  assert.ok(duplicateButtons.every(node => node.disabled));
  duplicateButtons[0].click();
  assert.equal(JSON.parse(app.stored()).entries.length, 1);
  const notes = '<img src=x onerror="evil()">\n \t=SUM(A1)';
  app.get("plan-0-notes").value = notes;
  app.get("plan-0-notes").fire("input");
  app.get("plan-0-owner").value = "My local proposal";
  app.get("plan-0-owner").fire("input");
  app.get("plan-0-decision").value = "Deferred";
  app.get("plan-0-decision").fire("change");
  const saved = JSON.parse(app.stored());
  assert.equal(saved.version, 1);
  assert.equal(saved.snapshot_id, "snapshot-one");
  assert.equal(saved.entries[0].notes, notes);
  assert.equal(saved.entries[0].decision, "Deferred");
  assert.equal(app.get("headline").textContent, "Start here: 2 decisions for the category review");
  const reloaded = boot({ stored: app.stored() });
  assert.equal(reloaded.get("plan-0-notes").value, notes);
  assert.equal(reloaded.get("plan-0-owner").value, "My local proposal");
  assert.equal(reloaded.all("img").length, 0);
  reloaded.get("select-all-plan").checked = false;
  reloaded.get("select-all-plan").fire("change");
  assert.equal(reloaded.get("export-plan").disabled, true);
  const remove = descendants(reloaded.get("plan-entries")).find(node => node.tagName === "BUTTON" && node.textContent === "Remove from plan");
  remove.click();
  assert.equal(JSON.parse(reloaded.stored()).entries.length, 0);
  assert.equal(reloaded.get("export-plan").disabled, true);
  assert.equal(reloaded.document.activeElement, reloaded.get("plan-heading"));
});

test("corrupted saved content is recoverable and never overwritten by real UI edits", async () => {
  const raw = '{"version":404,"entries":[{"notes":"preserve me"}]}';
  const app = boot({ stored: raw });
  assert.equal(app.get("storage-warning").hidden, false);
  assert.match(app.get("storage-warning-text").textContent, /left untouched/);
  assert.equal(app.get("export-preserved-storage").hidden, false);
  addFirst(app);
  app.get("plan-0-notes").value = "New memory-only work";
  app.get("plan-0-notes").fire("input");
  assert.equal(app.stored(), raw);
  assert.equal(app.writes.length, 0);
  app.get("export-preserved-storage").click();
  assert.equal(await app.blobs[0].text(), raw);
  assert.equal(app.document.downloads[0].filename, "preserved-category-review-plan.json");
});

test("real UI warns on storage read or quota failure without losing the current plan", () => {
  for (const options of [{ unavailableStorage: true }, { quotaFailure: true }]) {
    const app = boot(options);
    addFirst(app);
    app.get("plan-0-notes").value = "Still in memory";
    app.get("plan-0-notes").fire("input");
    assert.equal(app.get("storage-warning").hidden, false);
    assert.match(app.get("storage-warning-text").textContent, /memory only/);
    assert.equal(app.get("plan-count").textContent, "(1)");
    assert.equal(app.get("export-plan").disabled, false);
    assert.equal(app.writes.length, 0);
  }
});

test("real UI keeps unavailable entries and requires explicit acknowledgement on a new snapshot", () => {
  const old = boot();
  addFirst(old);
  old.get("plan-0-notes").value = "Preserve this decision";
  old.get("plan-0-notes").fire("input");
  const newData = payload();
  newData.snapshot_id = "snapshot-two";
  newData.opportunities[0].next_step = "Updated next step";
  newData.recommendations[0].next_step = "Updated next step";
  const app = boot({ stored: old.stored(), data: newData });
  assert.match(app.get("plan-entries").textContent, /Requires revalidation/);
  assert.equal(app.get("plan-0-notes").value, "Preserve this decision");
  const ack = descendants(app.get("plan-entries")).find(node => node.tagName === "BUTTON" && node.textContent === "Acknowledge current evidence");
  ack.click();
  assert.equal(JSON.parse(app.stored()).entries[0].revalidation_required, false);
  assert.equal(JSON.parse(app.stored()).entries[0].source_item.next_step, "Updated next step");
  assert.equal(app.get("plan-0-notes").value, "Preserve this decision");
  newData.opportunities = [];
  newData.recommendations = [];
  const missing = boot({ stored: app.stored(), data: newData });
  assert.match(missing.get("plan-entries").textContent, /Unavailable in current snapshot/);
  assert.equal(missing.get("plan-count").textContent, "(1)");
  assert.equal(missing.get("plan-0-notes").value, "Preserve this decision");
  assert.equal(descendants(missing.get("plan-entries")).filter(node => node.textContent === "Acknowledge current evidence").length, 0);
});

test("real UI explains changed actions and requires explicit adoption even when the source hash is unchanged", () => {
  const old = boot();
  addFirst(old);
  old.get("plan-0-notes").value = "My decision was for the original action";
  old.get("plan-0-notes").fire("input");
  old.get("plan-0-decision").value = "Accepted";
  old.get("plan-0-decision").fire("change");
  const newData = payload();
  newData.opportunities[0].primary_action = "New action from updated rules";
  newData.opportunities[0].title = "Review a different action for HC0004";
  newData.opportunities[0].next_step = "Validate this different suggested action";
  const app = boot({ stored: old.stored(), data: newData });
  assert.equal(app.get("app-error").hidden, true, app.get("app-error").textContent);
  assert.match(app.get("plan-entries").textContent, /Requires revalidation/);
  assert.match(app.get("plan-entries").textContent, /suggested action changed/);
  assert.match(app.get("plan-entries").textContent, /Saved plan actionFix availability/);
  assert.match(app.get("plan-entries").textContent, /Current suggested actionNew action from updated rules/);
  assert.equal(JSON.parse(app.stored()).entries[0].source_item.primary_action, "Fix availability");
  assert.equal(app.get("plan-0-notes").value, "My decision was for the original action");
  assert.equal(app.get("plan-0-decision").value, "Accepted");
  const savedView = descendants(app.get("plan-entries")).find(node => node.tagName === "BUTTON" && node.textContent === "View saved evidence");
  savedView.click();
  assert.equal(app.get("evidence-title").textContent, sku().title);
  app.get("close-evidence").click();
  const currentView = descendants(app.get("plan-entries")).find(node => node.tagName === "BUTTON" && node.textContent === "View current evidence");
  currentView.click();
  assert.equal(app.get("evidence-title").textContent, "Review a different action for HC0004");
  app.get("close-evidence").click();
  const adopt = descendants(app.get("plan-entries")).find(node => node.tagName === "BUTTON" && node.textContent === "Adopt updated action & evidence");
  assert.ok(adopt);
  adopt.click();
  assert.equal(JSON.parse(app.stored()).entries[0].revalidation_required, false);
  assert.equal(JSON.parse(app.stored()).entries[0].source_item.primary_action, "New action from updated rules");
  assert.equal(app.get("plan-0-notes").value, "My decision was for the original action");
  assert.equal(app.get("plan-0-decision").value, "Accepted");
  assert.equal(app.document.activeElement, app.get("plan-0-decision"));
});

test("real filters combine and reset; filtered tables do not prevent flagged or unflagged map evidence", () => {
  const app = boot();
  app.get("filter-brand").value = "Brand A";
  app.get("filter-private").value = "false";
  app.get("filter-action").value = "A future action";
  app.get("filter-action").fire("change");
  assert.match(app.get("filter-count").textContent, /1 of 2 SKUs · 0 of 1/);
  app.get("filter-search").value = "unmatchable query";
  app.get("filter-search").fire("input");
  assert.match(app.get("opportunity-table").textContent, /No matching rows/);
  assert.match(app.get("gap-table").textContent, /No matching rows/);
  assert.equal(app.get("export-opportunities").disabled, true);
  assert.equal(app.get("export-gaps").disabled, true);
  const points = app.all("circle");
  assert.equal(points.length, 2);
  points[0].fire("keydown", { key: "Enter" });
  assert.equal(app.get("evidence-title").textContent, sku().title);
  assert.match(app.get("evidence-body").textContent, /Stock statusOut of stock/);
  app.get("close-evidence").click();
  points[1].click();
  assert.match(app.get("evidence-body").textContent, /No rule matched/);
  assert.match(app.get("evidence-body").textContent, /Not supplied/);
  assert.equal(app.get("filter-search").value, "unmatchable query");
  app.get("close-evidence").click();
  app.get("reset-filters").click();
  assert.match(app.get("filter-count").textContent, /2 of 2 SKUs · 1 of 1/);
  assert.equal(app.get("export-opportunities").disabled, false);
});

test("downloads use typed UTF-8 CSV and defer URL revocation; export failures are visible", async () => {
  const app = boot();
  addFirst(app);
  app.get("export-plan").click();
  assert.equal(app.blobs.length, 1);
  assert.equal(app.blobs[0].type, "text/csv;charset=utf-8");
  // Blob.text() strips a leading UTF-8 BOM, so inspect the encoded bytes as well.
  assert.equal(Buffer.from(await app.blobs[0].arrayBuffer()).subarray(0, 3).toString("hex"), "efbbbf");
  assert.match(await app.blobs[0].text(), /"sku-HC0004"/);
  assert.equal(app.timers.length, 1);
  assert.ok(app.timers[0].delay >= 30000);
  assert.equal(app.revoked.length, 0);
  app.timers[0].handler();
  assert.equal(app.revoked.length, 1);
  const blocked = boot({ exportFailure: true });
  addFirst(blocked);
  blocked.get("export-plan").click();
  assert.equal(blocked.get("app-error").hidden, false);
  assert.match(blocked.get("app-error").textContent, /Export failed: Download blocked/);
  assert.equal(blocked.get("plan-count").textContent, "(1)");
});

test("a cross-tab storage change protects both the current in-memory edits and the other saved copy", () => {
  const app = boot();
  addFirst(app);
  const writesBefore = app.writes.length;
  const otherRaw = '{"version":999,"notes":"other tab"}';
  app.windowEvents.get("storage")({ key: C.STORAGE_KEY, newValue: otherRaw });
  app.get("plan-0-notes").value = "Local work";
  app.get("plan-0-notes").fire("input");
  assert.equal(app.writes.length, writesBefore);
  assert.equal(app.get("storage-warning").hidden, false);
  assert.match(app.get("storage-warning-text").textContent, /another tab/);
  assert.equal(app.get("export-preserved-storage").hidden, false);
  assert.equal(app.get("plan-0-notes").value, "Local work");
});
