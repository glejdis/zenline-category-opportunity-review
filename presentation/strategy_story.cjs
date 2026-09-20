"use strict";

const deriveStrategyMetrics = require("./strategy_metrics.cjs");

module.exports = function buildStrategyStory(context) {
  const {
    pptx, review, summary, chosen, arch, archRender, ARCH_IMAGE, ARCHITECTURE,
    REPO, DEMO, W, H, M, C, FONT, S, fs, sha256, pages, pageInfo,
    text, shape, panel, badge, line, sourceIcon, newSlide, heading, notes,
    sourceRows, fullDecisionEvidence, shortName, decisionRow,
    number, eur, eurK, rate, points, signedRate, stock, dateText, shortDate, remember,
  } = context;
  const metrics = deriveStrategyMetrics(review);
  const actionCount = action => summary.action_counts[action] || 0;
  const supply = chosen.find(item => item.primary_action === "Fix availability");
  const zeroSales = chosen.find(item => item.primary_action === "Investigate zero sales");
  if (!supply || !zeroSales) throw new Error("Revisit the strategic storyline if the supply/listing shortlist changes.");
  const takeaway = (slide, message, dark = false) => {
    shape(slide, S.rect, M, 6.14, 12.23, 0.46, dark ? C.berry : C.blush);
    text(slide, message, M + 0.18, 6.24, 11.87, 0.25, {
      fontSize: 15.4, bold: true, color: dark ? C.ivory : C.berryDark,
    });
  };
  const label = (slide, value, x, y, w) => text(slide, value.toUpperCase(), x, y, w, 0.24, {
    fontSize: 11.8, bold: true, color: C.berry, charSpacing: 0.8,
  });

  // The recommendation is visible before the audience sees the analytical process.
  {
    const s = newSlide("Validate the five decisions before committing to commercial scale",
      "Executive recommendation · synthetic case study", true);
    shape(s, S.rect, 8.28, 0, W - 8.28, 6.66, C.berryDark);
    text(s, "ZENBEAUTY RETAIL  /  HAIR COLOURATION", 0.65, 0.64, 7.0, 0.26, {
      fontSize: 12, bold: true, color: C.roseLight, charSpacing: 1.6,
    });
    text(s, "Validate first.\nPilot selectively.\nScale on evidence.", 0.65, 1.38, 7.3, 2.15, {
      fontFace: "Georgia", fontSize: 42, color: C.ivory, valign: "top",
    });
    text(s, "A decision agenda for the next category review", 0.65, 3.94, 7.05, 0.42, {
      fontSize: 23, color: C.ivory, bold: true,
    });
    text(s, "Start with supply and listing checks.\nResolve range questions before testing spend.", 0.65, 4.65, 7.05, 0.92, {
      fontSize: 22, color: C.darkMuted,
    });
    text(s, `Executive discussion  |  ${dateText}`, 0.65, 6.18, 7.05, 0.28, {
      fontSize: 15, color: C.roseLight,
    });
    [
      [number(summary.n_skus), "products assessed", "Defined scope"],
      [number(summary.n_flagged), "rule-matched review items", "Not proven problems"],
      [String(chosen.length), "initial product decisions", "Not an automatic rollout"],
    ].forEach(([value, title, meaning], i) => {
      const y = 1.0 + i * 1.78;
      text(s, value, 8.75, y, 3.90, 0.74, {
        fontFace: "Georgia", fontSize: 58, color: C.ivory,
      });
      text(s, title, 8.75, y + 0.89, 3.95, 0.35, {
        fontSize: 19.5, color: C.ivory, bold: true,
      });
      text(s, meaning, 8.75, y + 1.30, 3.95, 0.27, {
        fontSize: 14.8, color: C.roseLight,
      });
    });
    notes(s, 35,
      "The recommendation is to validate five concrete decisions, not to approve a category-wide rollout or a financial target. Start with prerequisites—availability and listing—then settle lifecycle questions and test commercial changes with a baseline. The review is based on synthetic data, and no business benefit has yet been measured.",
      { facts: summary, selected_ids: chosen.map(item => item.product_id), proposal: "A focused validation and test sequence, not an approved programme." });
  }

  {
    const s = newSlide("Approve a focused pilot—not a category-wide rollout",
      "Executive synthesis · source: review.json");
    heading(s, "Approve a focused pilot—not a category-wide rollout",
      "Three conclusions for leadership; one bounded decision to take today.", 32);
    const rows = [
      {
        n: "1", title: "Validate operational prerequisites first",
        evidence: `${actionCount("Fix availability")} stock flags: ${summary.availability_out_of_stock} out of stock, ${summary.availability_low_stock} low stock.\n${summary.zero_sales_count} in-stock products have zero-sales signals.`,
        implication: "Check supply, listings and feeds\nbefore promotional spend.",
      },
      {
        n: "2", title: "Reassess range decisions; do not automate them",
        evidence: `${summary.reactivation_count} inactive products have growing market proxies.\nThe reasons for inactivity are not supplied.`,
        implication: "Confirm the reason for inactivity\nbefore changing the range.",
      },
      {
        n: "3", title: "Treat modeled value as a test hypothesis",
        evidence: "Peer benchmarks provide scenarios—not forecasts.\nNo realised uplift, ROI or time saving is measured.",
        implication: "Agree a baseline and test economics;\nexpand only after observed results.",
      },
    ];
    label(s, "What the evidence says", 1.13, 2.26, 6.37);
    label(s, "Management implication", 8.27, 2.26, 4.21);
    rows.forEach((row, i) => {
      const y = 2.70 + i * 1.02;
      if (i % 2 === 0) shape(s, S.rect, M, y - 0.08, 12.23, 1.00, C.paper);
      badge(s, row.n, M + 0.08, y + 0.09, 0.34);
      text(s, row.title, 1.13, y, 6.70, 0.29, { fontSize: 19.4, bold: true });
      text(s, row.evidence, 1.13, y + 0.38, 6.70, 0.47, { fontSize: 15.8, color: C.muted });
      text(s, row.implication, 8.27, y + 0.11, 4.22, 0.66, { fontSize: 17.5, color: C.berryDark });
    });
    takeaway(s, "Decision requested: endorse the five checks, name accountable owners and agree pilot success criteria.");
    notes(s, 60,
      "This is the governing answer. We recommend a limited, evidence-led pilot, not a broad promotional programme or automated range change. The immediate agenda is operational validation, lifecycle context and explicit economics. Leadership should endorse the initial five checks, nominate owners and require agreed success criteria before any test or production investment. The recommendation is managerial judgment informed by the snapshot, not an observed customer mandate.",
      { source: summary, selected_ids: chosen.map(item => item.product_id), proposed_leadership_ask: ["Endorse five checks", "Nominate category and functional owners", "Agree baseline and success criteria"], outcome_limit: "No realised commercial or productivity effect measured." });
  }

  {
    const s = newSlide("134 flagged products require three distinct management responses",
      "Source: review.json · mutually exclusive primary-action groups");
    heading(s, `${summary.n_flagged} flagged products require three distinct responses`,
      "The complete primary-action queue—grouped by the type of management decision required.", 32);
    const maxCount = Math.max(...metrics.responses.map(group => group.count));
    const descriptions = {
      operations: `${actionCount("Fix availability")} availability + ${actionCount("Investigate zero sales")} zero-sales checks`,
      range: `${actionCount("Review reactivation")} reactivation + ${actionCount("Confirm exit")} exit confirmation\n+ ${actionCount("Review delist / markdown")} range / markdown + ${actionCount("Review seasonal range")} seasonal reviews`,
      commercial: `${actionCount("Review price benchmark")} price comparisons + ${actionCount("Test promotion")} promotion tests\n+ ${actionCount("Review margin")} margin reviews`,
    };
    const implications = {
      operations: "Diagnose the issue before spending",
      range: "Validate product role before changing the range",
      commercial: "Validate economics before a controlled test",
    };
    label(s, "Response / cases", M, 2.23, 6.55);
    label(s, "What this means", 8.15, 2.23, 4.55);
    metrics.responses.forEach((group, i) => {
      const y = 2.67 + i * 1.02;
      text(s, group.name, M, y, 3.18, 0.32, { fontSize: 18.8, bold: true });
      shape(s, S.rect, 3.96, y + 0.04, 3.18, 0.24, C.taupe);
      shape(s, S.rect, 3.96, y + 0.04, 3.18 * group.count / maxCount, 0.24,
        i === 0 ? C.berry : i === 1 ? C.rose : C.berryDark);
      text(s, String(group.count), 7.27, y - 0.015, 0.59, 0.36, {
        fontSize: 25, bold: true, color: C.berry,
      });
      text(s, descriptions[group.key], M, y + 0.42, 7.15, 0.47, {
        fontSize: 15.1, color: C.muted,
      });
      text(s, implications[group.key], 8.15, y + 0.02, 4.57, 0.74, {
        fontSize: 19, color: C.berryDark,
      });
    });
    text(s, `${metrics.no_rule_match} of ${summary.n_skus} products matched no rule—not a validation of product health.`,
      M, 5.83, 12.10, 0.25, { fontSize: 14.8, color: C.muted });
    takeaway(s, `${review.assortment_gaps.length} assortment follow-up cells are a separate analysis—not additional SKU cases.`);
    notes(s, 65,
      `The ${summary.n_flagged} rule-matched products form a complete, mutually exclusive decomposition using each SKU's primary action: ${metrics.responses.map(group => `${group.count} ${group.name.toLowerCase()}`).join(', ')}. They require different responses rather than one generic opportunity score. Secondary flags are not extra products. ${metrics.no_rule_match} products matched no rule; they have not been certified healthy. The ${review.assortment_gaps.length} assortment cells are a separate unit of analysis.`,
      { response_groups: metrics.responses, source_action_counts: summary.action_counts, no_rule_match: metrics.no_rule_match, denominator: `${summary.n_flagged} primary-action SKUs; ${summary.n_skus} total SKUs`, assortment_cells: review.assortment_gaps.length, coverage_assertion: `${metrics.responses.map(group => group.count).join(" + ")} = ${summary.n_flagged}; no overlap; no omitted primary actions.` });
  }

  {
    const s = newSlide("Assign these five checks before changing spend or range",
      "Source: review.json · selected decisions, owners and raw source IDs");
    heading(s, "Assign these five checks before changing spend or range",
      "Selected for review order and breadth—not to maximise the modeled financial total.", 32);
    [
      ["PRODUCT / RECORD", 0.76, 3.30],
      ["WHY THIS DECISION", 4.20, 4.25],
      ["NEXT CHECK / PROPOSED OWNER", 8.72, 3.84],
    ].forEach(([value, x, width]) => label(s, value, x, 2.07, width));
    chosen.forEach((item, i) => {
      const y = 2.50 + i * 0.69;
      const row = decisionRow(item);
      shape(s, S.rect, M, y, 12.23, 0.69, i % 2 ? C.blush : C.paper);
      text(s, shortName(item), 0.76, y + 0.07, 3.23, 0.28, { fontSize: 15.6, bold: true });
      text(s, item.product_id, 0.76, y + 0.43, 3.23, 0.18, {
        fontSize: 12.1, color: C.berry, bold: true, charSpacing: 0.6,
      });
      text(s, row.evidence, 4.20, y + 0.075, 4.21, 0.51, { fontSize: 14.4 });
      text(s, row.action, 8.72, y + 0.065, 3.84, 0.28, { fontSize: 15.0, bold: true, color: C.berry });
      text(s, row.owner, 8.72, y + 0.39, 3.84, 0.24, { fontSize: 13.7, color: C.muted });
    });
    takeaway(s, "Keep owner, due date and accept/defer decision together; no stock, pricing or range change is automatic.");
    notes(s, 85,
      "These are the exact five decisions shown in the current dashboard, not five new consulting recommendations layered over the model. Selection follows operational checks, lifecycle context and commercial tests, taking one per primary action before repeats. It is not revenue maximisation. Assign the checks, not automatic commercial actions. Herbatint also needs a supply check, and Sunlit Peach requires seasonal context.",
      chosen.map(fullDecisionEvidence).join("\n\n"));
  }

  {
    const s = newSlide("Validate supply and listings before deploying promotion",
      "Source: review.json · availability cohort and selected product evidence");
    heading(s, "Validate supply and listings before deploying promotion",
      "Two operationally different signals should not receive the same commercial treatment.", 32);
    const stockFlags = actionCount("Fix availability");
    label(s, `Availability queue: ${stockFlags} primary cases`, M, 2.22, 6.45);
    const barX = M, barY = 2.71, barW = 5.64;
    shape(s, S.rect, barX, barY, barW, 0.48, C.blush);
    shape(s, S.rect, barX, barY, barW * summary.availability_out_of_stock / stockFlags, 0.48, C.berry);
    text(s, `${summary.availability_out_of_stock} out of stock`, M, 3.30, 2.44, 0.28, { fontSize: 17, bold: true, color: C.berry });
    text(s, `${summary.availability_low_stock} low stock`, 3.26, 3.30, 2.80, 0.28, { fontSize: 17, color: C.muted });
    text(s, `${eurK(metrics.out_of_stock.historical_channel_revenue_eur)} historical channel sales`, M, 3.94, 5.90, 0.40, {
      fontSize: 26, bold: true, color: C.berry,
    });
    text(s, `For ${metrics.out_of_stock.count} cases recorded as out of stock.\nSales cover the supplied 12-week window;\nstock timing and any lost sales are unknown.`,
      M, 4.50, 5.85, 0.97, { fontSize: 17.2, color: C.muted });
    panel(s, 6.83, 2.26, 5.95, 1.58, C.paper);
    badge(s, "A", 7.06, 2.52, 0.36);
    text(s, `${supply.product_id} | Validate supply`, 7.62, 2.46, 4.85, 0.32, { fontSize: 20, bold: true });
    text(s, `${stock(supply.stock_status)}; market trend ${signedRate(supply.market_trend_12w_pct)}.\nCheck physical stock, feed accuracy and lead time.`,
      7.06, 3.01, 5.17, 0.58, { fontSize: 17.2 });
    panel(s, 6.83, 4.10, 5.95, 1.66, C.blush);
    badge(s, "B", 7.06, 4.36, 0.36);
    text(s, `${zeroSales.product_id} | Validate the listing`, 7.62, 4.31, 4.86, 0.33, { fontSize: 20, bold: true });
    text(s, `In stock, ${eur(zeroSales.channel_revenue_eur_12w, 0)} recorded sales; ${zeroSales.seasonality} product.\nCheck the listing, sales feed and selling season.`,
      7.06, 4.88, 5.17, 0.61, { fontSize: 17.2 });
    takeaway(s, "What is missing: stock duration, live listing confirmation and comparable periods—not another promotion rule.");
    notes(s, 65,
      `The supply and listing cases are different operational hypotheses. The ${metrics.out_of_stock.count} out-of-stock primary cases have ${eur(metrics.out_of_stock.historical_channel_revenue_eur)} historical channel sales across the supplied 12-week window. That number is neither lost sales nor recoverable revenue; the stock-snapshot date and stock duration are unknown. The proposed first checks are operational, not an automatic spend decision.`,
      [
        JSON.stringify(metrics.out_of_stock, null, 2),
        "Historical-sales calculation: sum(channel_revenue_eur_12w) where primary_action = Fix availability and stock_status = out_of_stock.",
        fullDecisionEvidence(supply), fullDecisionEvidence(zeroSales),
      ].join("\n\n"));
  }

  {
    const s = newSlide("Shortlist economics are much smaller than the full scenario pool",
      "Source: review.json · primary-action and shortlist scenario calculations");
    heading(s, "Shortlist economics are smaller than the full scenario pool",
      "Revenue and gross profit use independent full-queue scales. Neither is an expected return.", 32);
    metrics.financial.forEach((item, i) => {
      const x = M + i * 6.29;
      const width = 5.94;
      panel(s, x, 2.32, width, 3.48, i === 0 ? C.paper : C.blush);
      text(s, `${item.value_type} scenario · 12 weeks`, x + 0.24, 2.58, width - 0.48, 0.36, {
        fontSize: 23, bold: true, color: C.berry,
      });
      text(s, `Full queue (${item.full_queue.case_count} cases)`, x + 0.24, 3.12, 3.76, 0.27, { fontSize: 16.7 });
      text(s, eurK(item.full_queue.value_eur), x + 4.0, 3.08, 1.59, 0.37, {
        fontSize: 24, bold: true, color: C.muted, align: "right",
      });
      shape(s, S.rect, x + 0.24, 3.58, width - 0.48, 0.21, C.taupe);
      text(s, "Within the five-product shortlist", x + 0.24, 4.13, 5.45, 0.28, {
        fontSize: 17, bold: true,
      });
      text(s, eurK(item.shortlist.value_eur), x + 0.24, 4.58, 3.05, 0.61, {
        fontSize: 42, bold: true, color: C.berry,
      });
      text(s, `${item.shortlist.case_count} quantified ${item.shortlist.case_count === 1 ? "case" : "cases"}`, x + 3.37, 4.71, 2.12, 0.30, {
        fontSize: 17.2, color: C.muted, align: "right",
      });
      shape(s, S.rect, x + 0.24, 5.43, width - 0.48, 0.16, C.taupe);
      shape(s, S.rect, x + 0.24, 5.43,
        (width - 0.48) * item.shortlist.value_eur / item.full_queue.value_eur, 0.16, C.berry);
    });
    takeaway(s, `Do not add revenue to gross profit. ${metrics.shortlist_unquantified} shortlisted decisions are unquantified; no realised benefit is measured.`);
    const scenarioCases = review.opportunities.filter(item => ["Revenue", "Gross profit"].includes(item.scenario.value_type));
    notes(s, 80,
      `The earlier headline totals refer to the full rule-matched queue. The selected five contain only ${eur(metrics.financial[0].shortlist.value_eur)} of revenue benchmark-distance scenarios across ${metrics.financial[0].shortlist.case_count} cases, and ${eur(metrics.financial[1].shortlist.value_eur)} of gross-profit scenarios in ${metrics.financial[1].shortlist.case_count} case. These must never be added, and the ${metrics.shortlist_unquantified} unquantified decisions are not zero-value opportunities. The peer distances are not causal forecasts. Gross profit holds current revenue constant, not volume or net profit. Costs, elasticity and cannibalisation are not modeled, the performance-window end is unknown, and annualisation is not justified.`,
      [
        `Exact revenue scenario: ${eur(summary.revenue_scenario_eur)}.`,
        `Exact gross-profit scenario: ${eur(summary.gross_profit_scenario_eur)}.`,
        `Exact shortlisted revenue scenario: ${eur(metrics.financial[0].shortlist.value_eur)}.`,
        `Exact shortlisted gross-profit scenario: ${eur(metrics.financial[1].shortlist.value_eur)}.`,
        "Revenue formula: max(0, market proxy x subcategory peer median ratio - current channel revenue).",
        "Gross-profit formula: max(0, current channel revenue x (peer median margin - current margin)).",
        "Each secondary flag is excluded from these totals. Selected records are a subset of primary-action records.",
        JSON.stringify(metrics.financial, null, 2), review.methodology.scenario,
        ...scenarioCases.map(item => `${item.product_id} | ${item.scenario.value_type} | ${item.scenario.formula} | ${sourceRows(item).replace(/\n/g, "; ")}`),
      ].join("\n"));
  }

  {
    const s = newSlide("A review record makes each decision owned and measurable",
      "Source: implemented dashboard workflow; proposed success measures");
    heading(s, "A review record makes each decision owned and measurable",
      "The delivered capability is traceability and follow-through—not yet a measured commercial outcome.", 32);
    const steps = [
      ["Evidence", "Source ID, metrics,\nassumptions and limits"],
      ["Decision", "Accept or defer;\nrecord the rationale"],
      ["Ownership", "Name the owner,\ndue date and status"],
      ["Follow-through", "Export the plan;\nreview the checkpoint"],
    ];
    steps.forEach(([title, detail], i) => {
      const x = M + i * 3.14;
      panel(s, x, 2.38, 2.81, 1.46, i === 3 ? C.blush : C.paper);
      badge(s, String(i + 1), x + 0.18, 2.59, 0.34);
      text(s, title, x + 0.67, 2.56, 1.94, 0.32, { fontSize: 21, bold: true });
      text(s, detail, x + 0.18, 3.08, 2.40, 0.52, { fontSize: 16.5, color: C.muted });
      if (i < 3) shape(s, S.chevron, x + 2.92, 2.94, 0.12, 0.24, C.rose);
    });
    label(s, "Proposed owner", M, 4.21, 3.41);
    label(s, "Review checkpoint", 4.10, 4.21, 8.44);
    [
      ["Category lead", "Every chosen item has a decision, owner and due date."],
      ["Supply / e-commerce", "Stock or listing/feed evidence is validated before spend."],
      ["Buyer / finance", "A baseline and net gross-profit measure are agreed before testing."],
    ].forEach(([owner, checkpoint], i) => {
      const y = 4.66 + i * 0.43;
      text(s, owner, M, y, 3.27, 0.29, { fontSize: 17.8, bold: true });
      text(s, checkpoint, 4.10, y, 8.41, 0.29, { fontSize: 17.3 });
    });
    takeaway(s, "Available now: browser-local review and export. Shared assignment and operational-system execution are not implemented.");
    notes(s, 60,
      "This is where the prototype becomes a usable product slice rather than only an analysis. Its four-step loop keeps evidence, decision, proposed ownership and a checkpoint together. The role scorecard is a proposed management cadence, not observed adoption. We have not measured time saved or business uplift. Local storage does not make this a shared workflow tool, and accepting a plan item changes no stock, prices or assortment.",
      {
        implementation_sources: ["dashboard_template.html", "README.md"],
        proposed_checkpoint_basis: chosen.map(item => ({ id: item.product_id, owner: item.suggested_owner, measure: item.success_measure })),
        current_limits: "Browser-local state; export for handoff; not shared assignment, ERP write-back or measured outcomes.",
      });
  }

  {
    const s = newSlide("Scale only after validation and a controlled pilot demonstrate value",
      "Leadership recommendation · proposed gates, not approved commitments", true);
    text(s, "DECISION REQUIRED", 0.65, 0.60, 10.20, 0.24, {
      fontSize: 12, bold: true, color: C.roseLight, charSpacing: 1.6,
    });
    text(s, "Approve the checks.\nMake scale conditional.", 0.65, 1.12, 11.84, 1.14, {
      fontFace: "Georgia", fontSize: 37, color: C.ivory, valign: "top",
    });
    const gates = [
      ["1", "VALIDATE", "Category lead + data owners",
        "Freshness, listing and lifecycle\nquestions are resolved."],
      ["2", "TEST", "Buyer + finance",
        "Scope, costs, baseline/control and\nsuccess criteria are agreed first."],
      ["3", "SCALE", "Sponsor + technology owner",
        "Review results and adoption;\nfund tooling only if justified."],
    ];
    gates.forEach(([n, name, owner, condition], i) => {
      const x = 0.65 + i * 4.18;
      panel(s, x, 2.74, 3.88, 2.40, i === 2 ? C.berry : C.berryDark);
      badge(s, n, x + 0.20, 2.99, 0.35, C.roseLight, C.berryDark);
      text(s, name, x + 0.72, 2.97, 2.88, 0.30, {
        fontSize: 20.5, bold: true, color: C.ivory,
      });
      text(s, owner, x + 0.20, 3.60, 3.46, 0.36, {
        fontSize: 16.5, bold: true, color: C.roseLight,
      });
      text(s, condition, x + 0.20, 4.18, 3.44, 0.68, { fontSize: 17.7, color: C.ivory });
    });
    text(s, "TODAY'S ASK", 0.65, 5.57, 1.70, 0.27, {
      fontSize: 12.4, bold: true, color: C.roseLight, charSpacing: 0.7,
    });
    text(s, "Endorse the five checks  |  Nominate owners  |  Agree pilot scope and success criteria",
      2.43, 5.51, 10.19, 0.43, { fontSize: 19.4, color: C.ivory, bold: true });
    text(s, "Open the live dashboard", 0.65, 6.23, 3.75, 0.30, {
      fontSize: 17.5, underline: true, color: C.roseLight, hyperlink: { url: DEMO },
    });
    text(s, "Source code and evidence", 4.67, 6.23, 4.0, 0.30, {
      fontSize: 17.5, underline: true, color: C.roseLight, hyperlink: { url: REPO },
    });
    notes(s, 65,
      "Leadership can approve a focused validation agenda without committing to a rollout or a quantified savings claim. Gate one settles data and business context. Gate two defines the treatment, costs, baseline or control and the success threshold before testing. Gate three reviews actual outcomes and adoption before considering production tooling. Owners and gates here are proposed, not assignments or a delivery promise. If evidence does not support a test or expansion, defer or stop. No dates or budgets have been invented.",
      { proposed_gates: gates, explicit_decisions: ["Endorse the five product checks", "Nominate accountable owners", "Agree scope, baseline and success criteria"], no_commitments: "No approved costs, timeline, business target or Azure deployment.", prototype_links: [DEMO, REPO] });
  }

  {
    const s = newSlide("Appendix: source controls keep the interpretation defensible",
      "Source: supplied CSVs; review.json methodology and data_quality");
    heading(s, "Source controls keep the interpretation defensible",
      "APPENDIX A  |  How the review separates an observed signal from a proposed action.", 32);
    const inputs = [
      ["sales", "SKU performance", "Revenue, units, margin,\nstatus and stock"],
      ["product", "Product metadata", "Product role, supplier,\nvariant and seasonality"],
      ["signals", "Competitor observations", "Category/shade context;\ncomparability unverified"],
    ];
    inputs.forEach(([icon, title, detail], i) => {
      const x = M + i * 4.18;
      panel(s, x, 2.31, 3.88, 1.52, C.paper);
      sourceIcon(s, icon, x + 0.18, 2.58);
      text(s, title, x + 1.04, 2.50, 2.58, 0.35, { fontSize: 18.3, bold: true });
      text(s, detail, x + 1.04, 3.06, 2.57, 0.55, { fontSize: 15.9, color: C.muted });
    });
    const controls = [
      ["Validate", "Required fields, joins and duplicates; preserve source IDs."],
      ["Apply guardrails", "Inactive is not an automatic delist; stock issues stay visible."],
      ["Prioritise", "Operational prerequisites first; review one concrete item per action."],
      ["Expose uncertainty", "Scenarios, assumptions, freshness and limits travel with the decision."],
    ];
    controls.forEach(([name, detail], i) => {
      const y = 4.17 + i * 0.40;
      text(s, name, M, y, 2.58, 0.29, { fontSize: 17.1, bold: true, color: C.berry });
      text(s, detail, 3.35, y, 9.42, 0.29, { fontSize: 16.7 });
    });
    const dq = review.data_quality;
    takeaway(s, `${shortDate(dq.competitor_observed_from)} competitor data: ${dq.competitor_age_days} days old; ${dq.invalid_signal_count} invalid scores excluded. The 12-week period end is unknown.`);
    notes(s, 45,
      "This appendix is the method, not the main recommendation. It joins the three source types, validates data structure and applies explicit business guardrails. Ranking thresholds are transparent heuristics—not learned causal effects. The same product IDs and evidence appear in the dashboard, exports and this deck. Competitor scores outside 0–100 are excluded from popularity calculations but preserved as raw evidence. Dates, role ambiguity and product comparability constrain how far a stakeholder can act.",
      { methodology: review.methodology, quality: review.data_quality, source_files: ["sku_performance.csv", "product_metadata.csv", "competitor_market_signals.csv"], implementation: "Deterministic Python standard-library analysis; no learned forecast or production cloud runtime." });
  }

  {
    const s = newSlide("Appendix: shared Azure workflow is a scale option—not a pilot prerequisite",
      "Source: shared architecture artwork/specification; official references in notes");
    text(s, "A shared Azure workflow is a scale option—not a pilot prerequisite",
      M, 0.54, 12.23, 0.67, { fontFace: FONT.heading, fontSize: 30.5, bold: true });
    text(s, "APPENDIX B  |  Proposed, not deployed. API, sign-in and shared-plan persistence still need building.",
      M, 1.29, 12.23, 0.32, { fontSize: 16.2, color: C.muted });
    const png = fs.readFileSync(ARCH_IMAGE);
    const pixelW = png.readUInt32BE(16), pixelH = png.readUInt32BE(20);
    const scale = Math.min(12.23 / pixelW, 5.02 / pixelH);
    const imageW = pixelW * scale, imageH = pixelH * scale;
    const x = (W - imageW) / 2, y = 1.68 + (5.02 - imageH) / 2;
    remember(s, "image", x, y, imageW, imageH);
    s.addImage({
      path: ARCH_IMAGE, x, y, w: imageW, h: imageH,
      altText: "Proposed Azure production architecture, identical to the dashboard Architecture view. Not deployed.",
      hyperlink: { url: `${REPO}/blob/main/architecture/production.svg` },
    });
    pageInfo.get(s).architecture_image = {
      source: "architecture\\production.png", sha256: sha256(ARCH_IMAGE),
      pixel_width: pixelW, pixel_height: pixelH,
      slide_width_inches: imageW, slide_height_inches: imageH,
      ...(archRender ? { shared_render_provenance: archRender } : {}),
    };
    notes(s, 40,
      "This is the same proposed architecture available from the dashboard's Architecture icon. It is intentionally in the appendix: the pilot does not require building a production platform first. App Service and Entra would support authenticated access; batch jobs and private Blob containers would version the evidence; PostgreSQL would support shared decisions and audit. This needs customer-specific requirements, security implementation and operational ownership. Nothing shown is provisioned by the prototype, and there is no retail-system write-back.",
      [
        `Architecture specification SHA-256: ${sha256(ARCHITECTURE)}`,
        `Shared architecture image SHA-256: ${sha256(ARCH_IMAGE)}`,
        ...(archRender ? [`Shared renderer and source/output hashes: ${JSON.stringify(archRender)}`] : []),
        JSON.stringify(arch, null, 2),
        ...arch.references.map(reference => `${reference.label}: ${reference.url}`),
      ].join("\n"));
  }
  return metrics;
};
