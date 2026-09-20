/* Build-time only. Run: node presentation\build_deck.cjs
 * Add --pptx-only to omit the optional LibreOffice/Python preview.
 * DECK_QA_DIR overrides the default presentation\.preview artifact directory.
 * All commercial facts are read from the current, local outputs\review.json.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const PptxGenJS = require('pptxgenjs');
const artifactSha256 = require('./artifact_sha256.cjs');

const ROOT = path.resolve(__dirname, '..');
const REVIEW = path.join(ROOT, 'outputs', 'review.json');
const ARCHITECTURE = path.join(ROOT, 'architecture', 'production.json');
const ARCH_IMAGE = path.join(ROOT, 'architecture', 'production.png');
const ARCH_RENDER = path.join(ROOT, 'architecture', 'production.render.json');
const PPTX = path.join(ROOT, 'outputs', 'business_review.pptx');
const PDF = path.join(ROOT, 'outputs', 'business_review.pdf');
const MANIFEST = path.join(ROOT, 'presentation', 'deck_manifest.json');
const QA = process.env.DECK_QA_DIR
  ? path.resolve(ROOT, process.env.DECK_QA_DIR)
  : path.join(ROOT, 'presentation', '.preview');
const REPO = 'https://github.com/glejdis/zenline-category-opportunity-review';
const DEMO = 'https://glejdis.github.io/zenline-category-opportunity-review/';
const W = 13.333333;
const H = 7.5;
const M = 0.55;
const C = {
  ink: '30282E',
  dark: '2C252B',
  berry: '6D2E46',
  berryDark: '502737',
  rose: 'BD8192',
  roseLight: 'E6BFCA',
  blush: 'F0DFE3',
  ivory: 'FAF6EF',
  paper: 'FFFDFA',
  taupe: 'E4DAD4',
  muted: '6F6268',
  darkMuted: 'D1BFC6',
};
const FONT = { heading: 'Georgia', body: 'Calibri' };

const relative = p => path.relative(process.cwd(), p);
const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const review = readJson(REVIEW);
const arch = readJson(ARCHITECTURE);
const archRender = fs.existsSync(ARCH_RENDER) ? readJson(ARCH_RENDER) : null;
const summary = review.summary;
const chosen = review.recommendations;
const sourceHash = sha256(REVIEW);
const asOf = new Date(`${review.generated}T12:00:00Z`);
const dateText = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(asOf);
const shortDate = value => new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T12:00:00Z`));
const number = value => Number(value).toLocaleString('en-GB');
const eur = (value, decimals = 2) => new Intl.NumberFormat('en-IE', {
  style: 'currency', currency: 'EUR',
  minimumFractionDigits: decimals, maximumFractionDigits: decimals,
}).format(value);
const eurK = (value, decimals = 1) => `€${(value / 1000).toFixed(decimals)}k`;
const rate = (value, decimals = 1) => `${(value * 100).toFixed(decimals)}%`;
const points = (value, decimals = 2) => `${value.toFixed(decimals)}%`;
const signedRate = value => `${value >= 0 ? '+' : ''}${rate(value)}`;
const stock = value => ({
  in_stock: 'In stock', out_of_stock: 'Out of stock', low_stock: 'Low stock',
}[value] || value);

assert.equal(review.schema_version, 2, 'Review schema changed; recheck deck mappings.');
assert.ok(/^[0-9a-f]+$/i.test(review.snapshot_id), 'A source snapshot ID is required.');
assert.equal(chosen.length, 5, 'This narrative requires five actual selected decisions.');
assert.equal(review.landscape.length, summary.n_skus);
assert.equal(review.opportunities.length, summary.n_flagged);
assert.equal(new Set(review.opportunities.map(x => x.product_id)).size, summary.n_flagged);
assert.equal(summary.availability_out_of_stock + summary.availability_low_stock,
  summary.action_counts['Fix availability']);
assert.equal(Object.values(summary.action_counts).reduce((a, b) => a + b, 0),
  summary.n_flagged);
assert.ok(fs.existsSync(ARCH_IMAGE),
  'Render the shared architecture\\production.png before building the deck.');
if (archRender) {
  assert.equal(archRender.text_hash_normalization, 'utf8-lf',
    'Rebuild the architecture to use checkout-independent text fingerprints.');
  for (const [field, file] of [
    ['source_sha256', 'production.mmd'],
    ['svg_sha256', 'production.svg'],
    ['png_sha256', 'production.png'],
  ]) {
    assert.equal(artifactSha256(path.join(ROOT, 'architecture', file)), archRender[field],
      `Shared architecture ${file} differs from production.render.json; rebuild the shared diagram.`);
  }
}
for (const [type, key] of [
  ['Revenue', 'revenue_scenario_eur'], ['Gross profit', 'gross_profit_scenario_eur'],
]) {
  const actual = review.opportunities
    .filter(x => x.scenario.value_type === type)
    .reduce((total, x) => total + x.scenario.value_eur, 0);
  assert.ok(Math.abs(actual - summary[key]) < 0.011, `${type} scenario total is inconsistent.`);
}
for (const item of chosen) {
  assert.ok(review.opportunities.some(x => x.id === item.id),
    `Selected decision ${item.id} is not in the opportunity records.`);
  assert.ok(item.source_refs.length && item.product_name && item.suggested_owner);
}

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'ZenBeauty Retail category opportunity review';
pptx.subject = 'Synthetic-data business walkthrough: evidence, decisions and a proposed pilot';
pptx.title = 'From a product snapshot to five decisions';
pptx.company = 'ZenBeauty Retail — fictional case study';
pptx.lang = 'en-GB';
pptx.theme = {
  headFontFace: FONT.heading,
  bodyFontFace: FONT.body,
  lang: 'en-GB',
};
const S = pptx.ShapeType;
const pages = [];
const pageInfo = new WeakMap();

function remember(slide, kind, x, y, w, h, text) {
  assert.ok([x, y, w, h].every(Number.isFinite), `Non-finite ${kind} geometry`);
  assert.ok(w >= 0 && h >= 0 && x >= -0.001 && y >= -0.001
    && x + w <= W + 0.001 && y + h <= H + 0.001, `${kind} outside slide bounds`);
  pageInfo.get(slide).elements.push({
    kind, x, y, w, h, ...(text === undefined ? {} : { text }),
  });
}

function text(slide, value, x, y, w, h, options = {}) {
  remember(slide, 'text', x, y, w, h,
    typeof value === 'string' ? value : value.map(v => v.text).join(''));
  slide.addText(value, {
    x, y, w, h,
    fontFace: FONT.body, fontSize: 18, color: C.ink,
    margin: 0, breakLine: false, valign: 'mid',
    paraSpaceAfter: 0, paraSpaceBefore: 0, fit: 'none',
    ...options,
  });
}

function shape(slide, kind, x, y, w, h, fill, options = {}) {
  remember(slide, 'shape', x, y, w, h);
  slide.addShape(kind, {
    x, y, w, h,
    line: { color: fill, transparency: 100 },
    fill: { color: fill },
    ...options,
  });
}

function panel(slide, x, y, w, h, fill = C.paper) {
  shape(slide, S.roundRect, x, y, w, h, fill, { radius: 0.12, rectRadius: 0.12 });
}

function badge(slide, value, x, y, size = 0.48, fill = C.berry, color = C.paper) {
  shape(slide, S.ellipse, x, y, size, size, fill);
  text(slide, value, x, y, size, size, {
    fontSize: value.length > 1 ? 13 : 17, bold: true, align: 'center', color,
  });
}

function line(slide, x, y, w, h, color, width = 1.2) {
  remember(slide, 'line', x, y, w, h);
  slide.addShape(S.line, { x, y, w, h, line: { color, width } });
}

function sourceIcon(slide, kind, x, y) {
  badge(slide, '', x, y, 0.68, C.blush);
  if (kind === 'sales') {
    [0.18, 0.30, 0.43].forEach((height, i) =>
      shape(slide, S.rect, x + 0.16 + i * 0.13, y + 0.49 - height,
        0.085, height, C.berry));
  } else if (kind === 'product') {
    shape(slide, S.roundRect, x + 0.205, y + 0.12, 0.27, 0.43, C.berry,
      { rectRadius: 0.03 });
    shape(slide, S.rect, x + 0.265, y + 0.09, 0.15, 0.06, C.berry);
    shape(slide, S.rect, x + 0.255, y + 0.30, 0.17, 0.075, C.ivory);
  } else {
    [0.20, 0.35, 0.50].forEach((cx, i) => {
      shape(slide, S.ellipse, x + cx - 0.065, y + 0.28 - i * 0.04,
        0.13, 0.13, C.berry);
    });
    line(slide, x + 0.19, y + 0.46, 0.33, 0, C.berry, 1.4);
  }
}

function newSlide(title, source, dark = false) {
  const slide = pptx.addSlide();
  slide.background = { color: dark ? C.dark : C.ivory };
  const meta = { number: pages.length + 1, title, source, dark, elements: [] };
  pages.push(meta);
  pageInfo.set(slide, meta);
  text(slide, `${source}  |  ${review.snapshot_id}`, M, 6.815, 11.58, 0.20, {
    fontSize: 10.5, color: dark ? C.darkMuted : C.muted,
  });
  text(slide, `${String(meta.number).padStart(2, '0')} / 10`, 12.20, 6.815, 0.58, 0.20, {
    fontSize: 10.5, color: dark ? C.darkMuted : C.muted, align: 'right',
  });
  return slide;
}

function heading(slide, title, subtitle, size = 34) {
  text(slide, 'ZENBEAUTY RETAIL  /  CATEGORY REVIEW', M, 0.50, 10.5, 0.19, {
    fontSize: 10.5, color: C.berry, bold: true, charSpacing: 1.3,
  });
  text(slide, title, M, 0.89, 12.23, 0.66, {
    fontFace: FONT.heading, fontSize: size, color: C.ink,
  });
  if (subtitle) {
    text(slide, subtitle, M, 1.67, 12.13, 0.40, {
      fontSize: 17.5, color: C.muted,
    });
  }
}

function notes(slide, seconds, talkTrack, evidence) {
  const meta = pageInfo.get(slide);
  const content = [
    `${meta.number}. ${meta.title}`,
    `Suggested speaking time: ${seconds} seconds. Whole deck: approximately 10–11 minutes.`,
    '',
    'TALK TRACK',
    talkTrack,
    '',
    'SOURCE AND REPRODUCIBILITY',
    'Authoritative build input: outputs\\review.json (local file; public main may lag).',
    `Snapshot ID: ${review.snapshot_id}`,
    `Review generated/as-of date: ${review.generated}`,
    `review.json SHA-256: ${sourceHash}`,
    'Inputs are synthetic. No result, task assignment or commercial action is approved or executed by this deck.',
    `Public repository: ${REPO}`,
    `Public dashboard (last deployed commit): ${DEMO}`,
    '',
    'EVIDENCE, DEFINITIONS AND LIMITS',
    typeof evidence === 'string' ? evidence : JSON.stringify(evidence, null, 2),
  ].join('\n');
  slide.addNotes(content);
  meta.seconds = seconds;
  meta.speaker_notes = content;
}

function sourceRows(item) {
  return item.source_refs.map(ref =>
    `${ref.file}: ${ref.record_id}, CSV row ${ref.row_number}`).join('\n');
}

function fullDecisionEvidence(item) {
  return [
    `${item.product_id} — ${item.product_name}`,
    `Primary action: ${item.primary_action}; also flagged: ${item.also_flagged.join(', ') || 'none'}`,
    `Proposed owner: ${item.suggested_owner}`,
    `Next step: ${item.next_step}`,
    `Success measure: ${item.success_measure}`,
    `Current status: ${item.status}; stock: ${item.stock_status}; seasonality: ${item.seasonality}`,
    `12-week revenue ${eur(item.channel_revenue_eur_12w)}; units ${number(item.channel_units_12w)}; margin ${rate(item.channel_margin_pct)}`,
    `12-week market proxy ${eur(item.market_revenue_eur_12w)}; market trend ${signedRate(item.market_trend_12w_pct)}`,
    `Channel/proxy ratio ${points(item.channel_to_market_ratio_pct, 8)}; peer ratio ${points(item.peer_ratio_pct, 8)}; peer margin ${rate(item.peer_margin_pct, 3)}`,
    `Peers (${item.peer_count}; subject excluded): ${item.peer_ids.join(', ')}`,
    `Scenario: ${JSON.stringify(item.scenario)}`,
    `Caveats: ${item.caveats.join(' ')}`,
    'Source records:', sourceRows(item),
  ].join('\n');
}

function shortName(item) {
  const known = {
    HC0070: ['Wella Blondor Light Blonde', 'Wella Blondor · Light Blonde'],
    HC0002: ['ZenBeauty Private Label Color Studio Sunlit Peach', 'Private label · Sunlit Peach'],
    HC0101: ['Bleach London White Toner Cool Ash Blonde', 'Bleach London · White Toner'],
    HC0024: ['Herbatint Permanent Herbal Color Natural Black', 'Herbatint · Natural Black'],
    HC0083: ['Madison Reed Root Touch Up Pearl Blonde', 'Madison Reed · Root Touch Up'],
  };
  const match = known[item.product_id];
  return match && match[0] === item.product_name ? match[1] : item.product_name;
}

function decisionRow(item) {
  const availability = stock(item.stock_status);
  const proxy = `${eurK(item.market_revenue_eur_12w)} market proxy`;
  switch (item.primary_action) {
    case 'Fix availability':
      return {
        evidence: `${availability} · ${proxy}\nMarket trend ${signedRate(item.market_trend_12w_pct)}`,
        action: 'Validate stock and lead time',
        owner: item.suggested_owner,
      };
    case 'Investigate zero sales':
      return {
        evidence: `${availability} · ${eur(item.channel_revenue_eur_12w, 0)} sales / ${number(item.channel_units_12w)} units\n${proxy} · ${signedRate(item.market_trend_12w_pct)} · ${item.seasonality}`,
        action: 'Check listing, feed and season',
        owner: item.suggested_owner.replace('operations', 'ops'),
      };
    case 'Review reactivation':
      return {
        evidence: `Inactive · ${proxy}\nMarket trend ${signedRate(item.market_trend_12w_pct)} · reason unknown`,
        action: 'Understand inactivity first',
        owner: item.suggested_owner,
      };
    case 'Review margin':
      return {
        evidence: `${rate(item.channel_margin_pct)} margin · ${eurK(item.channel_revenue_eur_12w)} revenue\n${item.stock_status === 'in_stock' ? 'Validate costs before a price change' : `Also ${availability.toLowerCase()}—check supply first`}`,
        action: 'Validate cost / terms and supply',
        owner: item.suggested_owner,
      };
    case 'Test promotion':
      return {
        evidence: `${availability} · channel / proxy ${points(item.channel_to_market_ratio_pct)}\nPeer ratio ${points(item.peer_ratio_pct)}—comparison, not share`,
        action: 'Small test with baseline / control',
        owner: item.suggested_owner.replace(' manager', ''),
      };
    default:
      throw new Error(`No reviewed business-language layout for ${item.primary_action}.`);
  }
}

// 1 — Premium editorial cover, with an editable product-to-decision visual.
{
  const s = newSlide('From a product snapshot to five decisions',
    'Synthetic inputs · review.json', true);
  shape(s, S.rect, 7.66, 0, W - 7.66, 6.66, C.berryDark);
  text(s, 'ZENBEAUTY RETAIL', 0.65, 0.63, 6.4, 0.26, {
    fontSize: 13, color: C.roseLight, charSpacing: 2.6, bold: true,
  });
  text(s, 'From a product\nsnapshot to\nfive decisions', 0.65, 1.40, 6.95, 2.38, {
    fontFace: FONT.heading, fontSize: 43, color: C.ivory, valign: 'top',
    lineSpacingMultiple: 1.04,
  });
  text(s, 'Hair-colour category opportunity review', 0.65, 4.18, 6.2, 0.38, {
    fontSize: 22, color: C.ivory,
  });
  text(s, 'What to examine. Who should own the check.\nWhat evidence would justify the next step.',
    0.65, 4.78, 6.1, 0.80, { fontSize: 19, color: C.darkMuted });
  text(s, `Synthetic snapshot  /  ${dateText}`, 0.65, 6.12, 6.2, 0.28, {
    fontSize: 15, color: C.roseLight,
  });
  text(s, 'A FOCUSED REVIEW', 8.15, 0.70, 4.40, 0.23, {
    fontSize: 11, color: C.roseLight, charSpacing: 2.0, align: 'center', bold: true,
  });
  shape(s, S.ellipse, 8.83, 1.37, 3.03, 3.03, C.ivory);
  text(s, number(summary.n_skus), 8.83, 2.03, 3.03, 0.85, {
    fontSize: 64, fontFace: FONT.heading, color: C.berryDark, align: 'center',
  });
  text(s, 'products', 8.83, 3.03, 3.03, 0.35, {
    fontSize: 20, color: C.berryDark, align: 'center',
  });
  shape(s, S.downArrow, 10.09, 4.50, 0.53, 0.47, C.roseLight);
  chosen.forEach((item, i) => {
    const x = 8.07 + i * 0.96;
    panel(s, x, 5.23, 0.76, 0.84, i === 0 ? C.roseLight : C.ivory);
    text(s, String(i + 1).padStart(2, '0'), x, 5.44, 0.76, 0.30, {
      fontSize: 20, bold: true, color: C.berryDark, align: 'center',
    });
  });
  text(s, `${chosen.length} chosen decisions`, 8.00, 6.25, 4.65, 0.30, {
    fontSize: 18, color: C.ivory, align: 'center',
  });
  notes(s, 45,
    `This is a review for a fictional retailer, using ${summary.n_skus} synthetic products. The goal is not to put every metric on a slide. It is to arrive at five specific, defensible decisions, show the evidence and uncertainties behind them, and agree who should validate the next step. None of the proposed actions or financial scenarios is a measured outcome.`,
    {
      fields: ['summary.n_skus', 'recommendations', 'generated', 'snapshot_id'],
      product_count: summary.n_skus,
      selected_ids: chosen.map(x => x.product_id),
      disclaimer: 'Synthetic data, not a deployed or approved commercial programme.',
    });
}

// 2 — Three different inputs, one small decision agenda.
{
  const s = newSlide('The issue: decisions are buried in separate data',
    'Sources: three supplied CSVs · review.json');
  heading(s, 'The issue: decisions are buried in separate data',
    'A snapshot can point to questions. It cannot explain every cause.', 33);
  const sources = [
    ['sales', 'SKU performance', 'Sales, units, margin,\nstatus and stock'],
    ['product', 'Product metadata', 'Brand, shade, supplier\nand seasonality'],
    ['signals', 'Competitor signals', 'Observed products,\nprices and trends'],
  ];
  sources.forEach(([icon, title, body], i) => {
    const x = M + i * 2.82;
    panel(s, x, 2.40, 2.55, 2.45);
    sourceIcon(s, icon, x + 0.22, 2.66);
    text(s, title, x + 0.22, 3.62, 2.15, 0.36, { fontSize: 18, bold: true });
    text(s, body, x + 0.22, 4.12, 2.15, 0.54, { fontSize: 16.5, color: C.muted });
  });
  panel(s, 9.20, 2.40, 3.58, 3.93, C.berry);
  text(s, 'Competing\nquestions', 9.47, 2.73, 3.05, 0.77, {
    fontFace: FONT.heading, fontSize: 25, color: C.ivory,
  });
  ['Availability', 'Listing', 'Range', 'Margins'].forEach((label, i) => {
    badge(s, String(i + 1), 9.49, 3.81 + i * 0.51, 0.30, C.roseLight, C.berry);
    text(s, label, 9.98, 3.79 + i * 0.51, 2.45, 0.34, {
      fontSize: 18, color: C.ivory,
    });
  });
  panel(s, M, 5.18, 8.19, 1.15, C.blush);
  text(s, 'Inactive ≠ unwanted', 0.80, 5.40, 3.84, 0.32, {
    fontSize: 21, fontFace: FONT.heading, color: C.berry,
  });
  text(s, 'Weak sales ≠ a stock cause', 4.58, 5.40, 3.80, 0.32, {
    fontSize: 20, fontFace: FONT.heading, color: C.berry,
  });
  text(s, 'Needed: a short, defensible action list—not a causal verdict.',
    0.80, 5.89, 7.66, 0.26, { fontSize: 16.5 });
  notes(s, 60,
    'The source files answer different questions. Performance tells us what was sold and the current flags; metadata adds product context; competitor observations add signals to investigate. They do not tell us why a product is inactive, how long stock has been missing or whether products are genuinely comparable. So the business issue is to connect these sources without turning correlation or a status flag into a commercial conclusion.',
    `Sources: sku_performance.csv; product_metadata.csv; competitor_market_signals.csv.\n${review.methodology.evidence}\n${review.data_quality.warnings.join('\n')}`);
}

// 3 — A native-shape process, not a programming walkthrough.
{
  const s = newSlide('Our approach: facts first, action second',
    'Source: review.json · methodology; README workflow');
  heading(s, 'Our approach: facts first, action second',
    'Operational prerequisites come before the biggest-looking number.');
  const steps = [
    ['Validate\nsources', 'Fields, IDs,\nvalues and dates.'],
    ['Apply explicit\nrules', 'Visible logic,\nopen to review.'],
    ['Rank\nprerequisites', 'Supply and listing\nbefore spend.'],
    ['Select five\nproducts', 'Named products,\nnot generic levers.'],
    ['Link evidence\nto the plan', 'Owner, decision\nand next measure.'],
  ];
  steps.forEach(([title, body], i) => {
    const x = M + i * 2.50;
    panel(s, x, 2.42, 2.24, 2.76, i === 4 ? C.blush : C.paper);
    badge(s, String(i + 1).padStart(2, '0'), x + 0.22, 2.69, 0.50);
    text(s, title, x + 0.22, 3.50, 1.90, 0.78, {
      fontSize: 19, bold: true, valign: 'top',
    });
    text(s, body, x + 0.22, 4.40, 1.90, 0.56, {
      fontSize: 16.3, color: C.muted, valign: 'top',
    });
    if (i < steps.length - 1) {
      shape(s, S.chevron, x + 2.30, 3.47, 0.13, 0.28, C.rose);
    }
  });
  text(s, 'Built', M, 5.71, 0.75, 0.30, { fontSize: 18, bold: true, color: C.berry });
  text(s, 'Repeatable analysis + a self-contained local dashboard',
    1.43, 5.70, 11.0, 0.34, { fontSize: 22, fontFace: FONT.heading });
  text(s, 'Explicit rules, not machine learning. Human approval, not automated commercial execution.',
    M, 6.25, 12.10, 0.28, { fontSize: 17, color: C.muted });
  notes(s, 60,
    'The approach separates facts from action. We validate first, apply explicit commercial rules, then rank operational checks before experiments. Selection produces five concrete products to discuss, with a proposed owner and success measure. The implementation is deliberately modest: a Python standard-library pipeline and a portable, standalone dashboard. There is no learned forecast and no automatic replenishment, pricing or range execution.',
    {
      source_files: ['analyze.py', 'README.md', 'dashboard_template.html', 'outputs\\review.json'],
      selection_rule: review.methodology.selection,
      explicit_thresholds: review.methodology.thresholds,
      implementation_limit: 'Deterministic stdlib analysis; no ML model; no live commercial-system writes.',
    });
}

// 4 — Distinguish SKU rule matches from assortment comparison cells.
{
  const s = newSlide('The analysis creates a focused review agenda',
    'Source: review.json · summary, opportunities, assortment_gaps');
  heading(s, 'The analysis creates a focused review agenda',
    'Rule matches identify what to examine—not proven problems.', 33);
  panel(s, M, 2.33, 3.27, 3.35, C.berry);
  text(s, number(summary.n_flagged), 0.84, 2.72, 2.70, 1.03, {
    fontFace: FONT.heading, fontSize: 74, color: C.ivory,
  });
  text(s, `of ${number(summary.n_skus)} products`, 0.84, 3.88, 2.68, 0.34, {
    fontSize: 21, color: C.ivory,
  });
  text(s, 'Matched at least\none review rule', 0.84, 4.43, 2.68, 0.70, {
    fontSize: 20, color: C.ivory,
  });
  shape(s, S.roundRect, 0.85, 5.34, 2.66, 0.12, C.rose, { rectRadius: 0.06 });
  shape(s, S.roundRect, 0.85, 5.34, 2.66 * summary.n_flagged / summary.n_skus,
    0.12, C.ivory, { rectRadius: 0.06 });
  const counts = [
    [summary.action_counts['Fix availability'], 'Availability reviews',
      `${summary.availability_out_of_stock} out of stock + ${summary.availability_low_stock} low stock`],
    [summary.zero_sales_count, 'Zero-sales checks', 'Listing, mapping or feed validation'],
    [summary.reactivation_count, 'Reactivation reviews', 'Understand the reason for inactivity'],
    [summary.action_counts['Test promotion'], 'Promotion-test candidates', 'Validate economics before a small test'],
  ];
  counts.forEach(([value, title, detail], i) => {
    const x = 4.17 + (i % 2) * 4.44;
    const y = 2.33 + Math.floor(i / 2) * 1.82;
    panel(s, x, y, 4.17, 1.53);
    text(s, String(value), x + 0.23, y + 0.19, 0.93, 0.71, {
      fontSize: 45, color: C.berry, fontFace: FONT.heading,
    });
    text(s, title, x + 1.28, y + 0.24, 2.67, 0.60, {
      fontSize: 19, bold: true,
    });
    text(s, detail, x + 0.23, y + 1.04, 3.72, 0.26, {
      fontSize: 15.2, color: C.muted,
    });
  });
  badge(s, String(review.assortment_gaps.length), M, 5.93, 0.44, C.blush, C.berry);
  text(s, 'Separate assortment follow-up cells', 1.21, 5.92, 5.10, 0.32, {
    fontSize: 20, bold: true,
  });
  text(s, 'Subcategory × shade comparisons—not product counts.',
    6.40, 5.94, 6.34, 0.29, { fontSize: 16, color: C.muted });
  text(s, 'Selected primary-action groups shown; not a full breakdown of all matched SKUs.',
    M, 6.40, 12.10, 0.29, { fontSize: 15, color: C.muted });
  notes(s, 65,
    `The rules match ${summary.n_flagged} of ${summary.n_skus} products. That is an investigation agenda, not a count of proven commercial failures. Availability has ${summary.action_counts['Fix availability']} primary cases: ${summary.availability_out_of_stock} out of stock and ${summary.availability_low_stock} low stock. The other highlighted groups are checks and test candidates, not guaranteed opportunities. The ${review.assortment_gaps.length} assortment cells are a different unit of analysis and must not be added to SKU counts.`,
    {
      summary,
      highlighted_groups: 'Four selected primary-action groups, not the complete decomposition of n_flagged.',
      counting_rule: 'One primary action per flagged SKU. Secondary flags are not additional SKUs or incremental audiences.',
      assortment_cell_count: review.assortment_gaps.length,
      assortment_ids: review.assortment_gaps.map(x => x.id),
      assortment_definition: 'Subcategory × shade follow-up comparisons; not missing-SKU or monetary opportunity counts.',
    });
}

// 5 — The actual current recommendations, with data-dependent evidence.
{
  const s = newSlide('Five decisions for the next category review',
    'Source: review.json · recommendations; full record IDs and rows in notes');
  heading(s, 'Five decisions for the next category review', '', 34);
  text(s, 'Proposed owners and next checks—not approved commercial actions.',
    M, 1.63, 12.10, 0.28, { fontSize: 17.5, color: C.muted });
  [
    ['PRODUCT', 0.76, 3.33],
    ['WHY REVIEW', 4.20, 4.09],
    ['NEXT CHECK / PROPOSED OWNER', 8.72, 3.80],
  ].forEach(([value, x, w]) => text(s, value, x, 2.04, w, 0.21, {
    fontSize: 11.4, color: C.berry, bold: true, charSpacing: 0.9,
  }));
  chosen.forEach((item, i) => {
    const y = 2.39 + i * 0.77;
    const row = decisionRow(item);
    shape(s, S.rect, M, y, 12.23, 0.77, i % 2 ? C.blush : C.paper);
    text(s, shortName(item), 0.76, y + 0.10, 3.24, 0.32, {
      fontSize: 16.2, bold: true,
    });
    text(s, item.product_id, 0.76, y + 0.48, 3.20, 0.21, {
      fontSize: 12.5, color: C.berry, bold: true, charSpacing: 0.9,
    });
    text(s, row.evidence, 4.20, y + 0.12, 4.25, 0.53, {
      fontSize: 15.5, valign: 'mid',
    });
    text(s, row.action, 8.72, y + 0.11, 3.82, 0.30, {
      fontSize: 15.5, color: C.berry, bold: true,
    });
    text(s, row.owner, 8.72, y + 0.45, 3.82, 0.26, {
      fontSize: 14.5, color: C.muted,
    });
  });
  text(s, 'Market figures are demand proxies. Inactivity reasons and stock duration remain unknown.',
    M, 6.45, 12.10, 0.22, { fontSize: 12, color: C.muted });
  notes(s, 105,
    'Read these as five real product conversations. Wella starts with a supply check. Sunlit Peach has stock but no recorded sales, so listing and feed validation come first, with a Summer caution. Bleach London needs an explanation for inactivity before any reactivation trial. Herbatint has a margin question, but is also out of stock: validate supply before making volume assumptions. Madison Reed is a candidate for a small, controlled merchandising test, not a promise that a peer ratio is attainable. The proposed owners have not been assigned automatically.',
    chosen.map(fullDecisionEvidence).join('\n\n'));
}

// 6 — Two visibly separate measures; neither is an outcome or a forecast.
{
  const s = newSlide('Financial scenarios guide questions, not promises',
    'Source: review.json · summary and primary-action SKU scenarios');
  heading(s, 'Financial scenarios guide questions, not promises',
    'Supplied 12-week window · all primary-action SKU cases, not just the five decisions.', 32);
  panel(s, M, 2.25, 12.23, 0.47, C.berry);
  text(s, 'NO REALISED BENEFIT MEASURED', 0.77, 2.35, 11.79, 0.25, {
    fontSize: 15.5, bold: true, color: C.ivory, charSpacing: 1.1, align: 'center',
  });
  [
    {
      x: M, label: 'Revenue benchmark-distance scenario',
      value: eurK(summary.revenue_scenario_eur, 0),
      description: 'Distance to a typical peer ratio\nin the same subcategory.',
      limit: 'Not a sales forecast.',
    },
    {
      x: 6.83, label: 'Gross-profit benchmark scenario',
      value: eurK(summary.gross_profit_scenario_eur),
      description: 'Current revenue held constant;\nmargin moved to the peer median.',
      limit: 'Not additional revenue or net profit.',
    },
  ].forEach(item => {
    panel(s, item.x, 3.01, 5.95, 2.67);
    text(s, item.label, item.x + 0.26, 3.28, 5.43, 0.33, {
      fontSize: 18, bold: true,
    });
    text(s, item.value, item.x + 0.24, 3.78, 5.40, 0.80, {
      fontFace: FONT.heading, fontSize: 58, color: C.berry,
    });
    text(s, item.description, item.x + 0.26, 4.72, 5.40, 0.59, { fontSize: 18 });
    text(s, item.limit, item.x + 0.26, 5.34, 5.40, 0.22, {
      fontSize: 15.5, color: C.berry, bold: true,
    });
  });
  text(s, 'Separate measures. Do not add them. No annualisation.',
    M, 5.98, 12.20, 0.36, { fontSize: 23, fontFace: FONT.heading });
  text(s, 'Not guarantees or upper bounds. Costs, elasticity and cannibalisation are not modelled; period end unknown.',
    M, 6.46, 12.20, 0.22, { fontSize: 13.5, color: C.muted });
  const scenarioCases = review.opportunities.filter(x =>
    ['Revenue', 'Gross profit'].includes(x.scenario.value_type));
  notes(s, 75,
    `These are deliberately separate scenario measures. ${eur(summary.revenue_scenario_eur)} is the total distance to subcategory peer ratios across applicable primary-action SKU cases. ${eur(summary.gross_profit_scenario_eur)} is a margin scenario holding current revenue constant. Neither is actual uplift, ROI, a forecast, a conservative ceiling or an upper bound. We cannot annualise the snapshot, and costs, elasticity and cannibalisation are not modelled. The numbers guide which questions to validate; the pilot would have to measure the benefit.`,
    [
      `Exact revenue scenario: ${eur(summary.revenue_scenario_eur)}.`,
      `Exact gross-profit scenario: ${eur(summary.gross_profit_scenario_eur)}.`,
      'Scope: all opportunities with a primary-action SKU scenario, not recommendations only; no secondary-flag double counting.',
      'Revenue formula per eligible SKU: max(0, market_revenue_eur_12w × peer_ratio_pct / 100 − channel_revenue_eur_12w).',
      'Gross-profit formula per eligible SKU: max(0, channel_revenue_eur_12w × (peer_margin_pct − channel_margin_pct)).',
      'Peers: other active, in-stock, selling SKUs in the same subcategory; subject SKU excluded. No usable peers means not estimated.',
      'All scenario inputs are for the supplied 12-week window. Its end date is not provided. No annualisation.',
      'Zero-sales, lifecycle and assortment investigations have no defensible monetary estimate from these data.',
      `Descriptive channel / market-demand-proxy ratio: ${points(summary.channel_to_market_ratio_pct, 8)}. This is not verified market share or evidence of execution quality.`,
      review.methodology.scenario,
      '',
      'Per-case source IDs and calculations:',
      ...scenarioCases.map(x =>
        `${x.product_id} | ${x.scenario.value_type} | ${x.scenario.formula} | ${sourceRows(x).replace(/\n/g, '; ')}`),
    ].join('\n'));
}

// 7 — The capability delivered is a review with accountable checkpoints.
{
  const s = newSlide('What changes for stakeholders',
    'Source: review.json · proposed owners and success measures; README workflow');
  heading(s, 'What changes for stakeholders',
    'Traceability and accountability are built in. Commercial outcomes still need testing.');
  panel(s, M, 2.35, 3.38, 3.92, C.berry);
  text(s, 'Before', 0.85, 2.65, 2.80, 0.40, {
    fontFace: FONT.heading, fontSize: 29, color: C.ivory,
  });
  text(s, 'A signal can be\ndiscussed without\nan owner, a decision\nor a measured\nfollow-through.',
    0.85, 3.36, 2.77, 2.04, {
      fontSize: 23, color: C.ivory, valign: 'top',
    });
  text(s, 'Now: a proposed owner and a measurable next checkpoint',
    4.31, 2.36, 8.43, 0.44, { fontSize: 20.5, bold: true });
  const roles = [
    ['CL', 'Category lead', 'Own review decisions',
      'Decision completeness:\naccept/defer, owner and date'],
    ['SP', 'Supply planner', 'Validate stock and feed',
      'Availability confirmed;\nthen units and gross profit'],
    ['EC', 'E-commerce', 'Validate listing and sales feed',
      'First confirmed sales;\nunits and gross profit'],
    ['BF', 'Buyer + finance', 'Check costs, terms and tests',
      'Gross profit + units;\ninclude commercial costs'],
  ];
  roles.forEach(([initials, role, task, measure], i) => {
    const y = 3.00 + i * 0.83;
    badge(s, initials, 4.33, y + 0.04, 0.46, C.blush, C.berry);
    text(s, role, 5.00, y + 0.02, 3.28, 0.29, { fontSize: 18.5, bold: true });
    text(s, task, 5.00, y + 0.39, 3.32, 0.26, { fontSize: 15.5, color: C.muted });
    text(s, measure, 8.88, y + 0.07, 3.88, 0.61, { fontSize: 17.5 });
  });
  text(s, 'Proposed responsibilities, not assigned tasks. No adoption or time-saving benefit has been measured.',
    M, 6.47, 12.13, 0.21, { fontSize: 12, color: C.muted });
  notes(s, 60,
    'The benefit delivered by the prototype is a capability: an evidence trail and an accountable review plan. The category lead owns the decision; supply and e-commerce validate the prerequisites; buyers and finance validate commercial economics. Each discussion should finish with an owner, a decision and a next checkpoint. We have not measured adoption, hours saved or commercial impact, so those must not be claimed as delivered benefits.',
    {
      owner_and_measure_sources: chosen.map(x => ({
        id: x.product_id, suggested_owner: x.suggested_owner,
        next_step: x.next_step, success_measure: x.success_measure,
      })),
      proposed_cross_cutting_measure: 'Decision completeness: accepted/deferred decision plus explicit owner and due date.',
      limitation: 'Role labels are proposed stakeholder responsibilities, not executed assignments.',
    });
}

// 8 — Stylised native workflow, intentionally not a fabricated screenshot.
{
  const s = newSlide('A usable workflow, with clear limits',
    'Source: dashboard workflow; review.json · data_quality');
  heading(s, 'A usable workflow, with clear limits',
    'A browser-local plan supports the review. It is not yet a shared workflow system.');
  ['Review a decision', 'Inspect the evidence', 'Accept or defer', 'Export the plan']
    .forEach((value, i) => {
      const x = M + i * 3.14;
      panel(s, x, 2.37, 2.81, 1.18, i === 3 ? C.berry : C.paper);
      badge(s, String(i + 1).padStart(2, '0'), x + 0.20, 2.64,
        0.43, i === 3 ? C.roseLight : C.blush, C.berry);
      text(s, value, x + 0.80, 2.65, 1.83, 0.49, {
        fontSize: 18, bold: true, color: i === 3 ? C.ivory : C.ink,
      });
      if (i < 3) shape(s, S.chevron, x + 2.90, 2.84, 0.15, 0.25, C.rose);
    });
  panel(s, M, 3.89, 5.93, 2.39);
  panel(s, 6.85, 3.89, 5.93, 2.39, C.blush);
  text(s, 'Ready to use locally', 0.82, 4.13, 5.31, 0.36, {
    fontFace: FONT.heading, fontSize: 23,
  });
  [
    'Owners, due dates, progress and notes',
    'Source record / row drilldown',
    'CSV exports; no external UI dependency',
  ].forEach((value, i) => text(s, value, 0.84, 4.70 + i * 0.37, 5.22, 0.28, {
    fontSize: 17.2,
  }));
  text(s, 'Plans stay in this browser. Export before moving.',
    0.84, 5.86, 5.29, 0.30, { fontSize: 16, color: C.berry, bold: true });
  text(s, 'Know the evidence limits', 7.13, 4.13, 5.31, 0.36, {
    fontFace: FONT.heading, fontSize: 23,
  });
  const dq = review.data_quality;
  [
    `${shortDate(dq.competitor_observed_from)} observations · ${dq.competitor_age_days} days old`,
    `${dq.invalid_signal_count} invalid popularity scores excluded`,
    '12-week end and stock-snapshot date unknown',
  ].forEach((value, i) => text(s, value, 7.14, 4.76 + i * 0.48, 5.31, 0.29, {
    fontSize: 17,
  }));
  text(s, 'Accepting a plan item does not change stock, prices or assortment.',
    M, 6.47, 12.10, 0.22, { fontSize: 13.5, color: C.muted });
  notes(s, 60,
    `The working prototype supports a review loop: inspect a decision, open its evidence, accept or defer it and export the plan. Owners, due dates, status and notes are browser-local; they are not shared assignments. The diagram here is a stylised workflow, not a screenshot. Evidence dates are explicit: competitor observations are ${dq.competitor_age_days} days old at this review, ${dq.invalid_signal_count} invalid popularity scores are excluded, and the end of the 12-week sales window is missing. Freshness and source validation remain prerequisites to commercial use.`,
    {
      current_capability_source: 'README.md and dashboard_template.html',
      current_scope: 'Standalone HTML; no external UI dependencies, server, login or shared storage.',
      plan_meaning: 'Accept means accepted for review/action planning, not a change in operational retail systems.',
      storage_limit: 'Local file URLs, public site origins and different browsers may have separate local storage.',
      data_quality: dq,
      exclusions_definition: 'Out-of-range scores excluded from popularity averages/ranking; their prices and trend observations remain separate and unverified.',
    });
}

// 9 — Embed the shared source diagram, never a second architecture.
{
  const s = newSlide('A production path on Azure — proposed, not deployed',
    'Source: architecture\\production.png + production.json; official URLs in notes');
  text(s, 'A production path on Azure — proposed, not deployed', M, 0.55, 12.23, 0.59, {
    fontFace: FONT.heading, fontSize: 32,
  });
  text(s, 'Today: local dashboard + browser storage. API, SSO and shared plans are not implemented.',
    M, 1.23, 12.23, 0.27, { fontSize: 16.8, color: C.muted });
  const png = fs.readFileSync(ARCH_IMAGE);
  const pixelW = png.readUInt32BE(16);
  const pixelH = png.readUInt32BE(20);
  const maxW = 12.23;
  const maxH = 5.19;
  const scale = Math.min(maxW / pixelW, maxH / pixelH);
  const imageW = pixelW * scale;
  const imageH = pixelH * scale;
  const x = (W - imageW) / 2;
  const y = 1.57 + (maxH - imageH) / 2;
  remember(s, 'image', x, y, imageW, imageH);
  s.addImage({
    path: ARCH_IMAGE, x, y, w: imageW, h: imageH,
    altText: 'The shared, proposed Azure production architecture. Not deployed.',
    hyperlink: { url: `${REPO}/blob/main/architecture/production.svg` },
  });
  pageInfo.get(s).architecture_image = {
    source: 'architecture\\production.png',
    sha256: sha256(ARCH_IMAGE), pixel_width: pixelW, pixel_height: pixelH,
    slide_width_inches: imageW, slide_height_inches: imageH,
    ...(archRender ? { shared_render_provenance: archRender } : {}),
  };
  notes(s, 60,
    'Nothing on this architecture slide is deployed by this prototype. The proposed evolution keeps the deterministic analysis, runs it on a schedule and serves the dashboard through an authenticated API. The shared database would hold plans and audit history, replacing browser-only collaboration. Supporting controls make failed or stale refreshes visible. API implementation, sign-in, authorisation and shared storage are future work, justified only after a validated pilot. Human approval remains mandatory; this architecture does not write inventory, pricing or range decisions to retail systems.',
    [
      `Shared source diagram: architecture\\production.mmd; architecture\\production.png; architecture\\production.svg.`,
      `Public diagram reference: ${REPO}/blob/main/architecture/production.svg`,
      `Architecture specification SHA-256: ${sha256(ARCHITECTURE)}`,
      'Current local UI also includes an offline architecture reference panel and source downloads; the cloud architecture itself remains proposed and not deployed.',
      ...(archRender ? [`Shared renderer and source/output hashes: ${JSON.stringify(archRender)}`] : []),
      JSON.stringify(arch, null, 2),
      '',
      'Official service references supplied with the shared architecture:',
      ...arch.references.map(ref => `${ref.label}: ${ref.url}`),
    ].join('\n'));
}

// 10 — A sponsor decision, with explicit gates rather than a promised timeline.
{
  const s = newSlide('Leadership decision: validate, pilot, measure',
    'Synthetic case study · proposed next steps · review.json', true);
  text(s, 'THE LEADERSHIP DECISION', 0.65, 0.62, 7.0, 0.24, {
    fontSize: 12.5, bold: true, color: C.roseLight, charSpacing: 1.8,
  });
  text(s, 'Validate,\npilot, measure.', 0.65, 1.31, 7.10, 1.55, {
    fontFace: FONT.heading, fontSize: 47, color: C.ivory, valign: 'top',
  });
  text(s, 'Sponsor a controlled pilot,\nnot a promised uplift.',
    0.65, 3.13, 6.71, 0.97, {
      fontFace: FONT.heading, fontSize: 28, color: C.roseLight,
    });
  text(s, 'Name the category owner.\nConfirm source access and freshness.\nAgree success criteria before testing.',
    0.65, 4.55, 6.75, 1.16, {
      fontSize: 20, color: C.ivory, valign: 'top',
    });
  const phases = [
    ['Define', 'Owners + agreed data definitions'],
    ['Validate', 'Supply, listing and range checks'],
    ['Pilot', 'Time-bounded test with a baseline'],
    ['Only then scale', 'Shared Azure workflow, if justified'],
  ];
  phases.forEach(([title, detail], i) => {
    const y = 1.12 + i * 1.23;
    panel(s, 8.02, y, 4.68, 1.07, i === 3 ? C.berry : C.berryDark);
    badge(s, String(i + 1), 8.24, y + 0.25, 0.43, C.roseLight, C.berry);
    text(s, title, 8.88, y + 0.13, 3.58, 0.32, {
      fontSize: 20, color: C.ivory, bold: true,
    });
    text(s, detail, 8.88, y + 0.53, 3.55, 0.32, {
      fontSize: 16, color: C.darkMuted,
    });
  });
  text(s, 'Open the live demo', 0.65, 6.05, 2.90, 0.31, {
    fontSize: 18, bold: true, color: C.roseLight, underline: true,
    hyperlink: { url: DEMO, tooltip: DEMO },
  });
  text(s, 'Explore the repository', 3.78, 6.05, 3.44, 0.31, {
    fontSize: 18, bold: true, color: C.roseLight, underline: true,
    hyperlink: { url: REPO, tooltip: REPO },
  });
  text(s, 'Public links reflect the last deployed commit; local changes are not automatically live.',
    0.65, 6.48, 11.93, 0.20, { fontSize: 11.5, color: C.darkMuted });
  notes(s, 45,
    'The leadership ask is deliberately limited: name a category owner, secure source access and freshness ownership, and agree what successful validation or a test would look like. First settle definitions and check the highlighted supply, listing and lifecycle questions. Then run time-bounded commercial tests with a baseline or control and measure units and gross profit after costs. Only if that workflow proves useful should we invest in shared Azure deployment. These are proposed phases, not commitments, dated delivery promises or realised benefits.',
    [
      `Public demo: ${DEMO}`,
      `Public repository: ${REPO}`,
      'Public links refer to the last published/deployed commit; the local deck may be ahead.',
      'Synthetic-data disclaimer: the retailer, inputs and opportunity review are a fictional case study.',
      'Proposed sponsor decisions: category owner, data access/freshness owner, agreed test and decision-success criteria.',
      'No fixed costs, timeline, ROI, adoption level or measured time savings are asserted.',
      `Architecture rollout proposal: ${JSON.stringify(arch.rollout)}`,
    ].join('\n'));
}

assert.equal(pages.length, 10);
assert.ok(pages.every(x => x.speaker_notes.includes(review.snapshot_id)));
assert.ok(pages.every(x => x.elements.some(e => e.kind === 'shape' || e.kind === 'image')));

function runPreview() {
  const soffice = process.platform === 'win32'
    ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe' : 'soffice';
  if (process.platform === 'win32' && !fs.existsSync(soffice)) {
    throw new Error('LibreOffice is not installed at the configured preview path.');
  }
  fs.mkdirSync(relative(QA), { recursive: true });
  const profile = path.join(QA, `lo-profile-${process.pid}-${Date.now()}`);
  fs.mkdirSync(relative(profile), { recursive: true });
  if (fs.existsSync(PDF)) fs.unlinkSync(relative(PDF));
  let conversion;
  try {
    conversion = spawnSync(soffice, [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      '--headless', '--nologo', '--nodefault', '--nofirststartwizard',
      '--convert-to', 'pdf:impress_pdf_Export',
      '--outdir', path.join(ROOT, 'outputs'), PPTX,
    ], { cwd: ROOT, encoding: 'utf8', timeout: 120000, windowsHide: true });
    if (conversion.error) throw conversion.error;
    if (conversion.status !== 0 || !fs.existsSync(PDF)) {
      throw new Error(`LibreOffice preview failed: ${conversion.stderr || conversion.stdout || conversion.status}`);
    }
  } finally {
    // Only this run's isolated profile is removed; no shared process or profile is touched.
    if (!conversion || !conversion.error) {
      fs.rmSync(relative(profile), { recursive: true, force: true });
    }
  }
  const script = String.raw`
import json, sys, zipfile, re
from pathlib import Path
from xml.etree import ElementTree as ET
import pymupdf
from PIL import Image, ImageDraw, ImageFont

pptx_path, pdf_path, qa_path, snapshot = sys.argv[1:]
qa = Path(qa_path)
doc = pymupdf.open(pdf_path)
assert len(doc) == 10, f"Expected 10 PDF pages, found {len(doc)}"
page_texts = []
image_paths = []
boundary_warnings = []
overlap_warnings = []
for i, page in enumerate(doc):
    content = page.get_text("text")
    page_texts.append(content)
    assert snapshot in content, f"Snapshot footer missing from PDF page {i+1}"
    assert not re.search(r"lorem ipsum|xxxx|TODO|TBD", content, re.I), f"Placeholder on page {i+1}"
    assert "\ufffd" not in content, f"Replacement character on page {i+1}"
    pix = page.get_pixmap(matrix=pymupdf.Matrix(160/72, 160/72), alpha=False)
    image_path = qa / f"slide-{i+1:02d}.png"
    pix.save(str(image_path))
    image_paths.append(str(image_path))
    spans = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                if span.get("text", "").strip():
                    spans.append(span)
                x0,y0,x1,y1 = span["bbox"]
                if x0 < 33 or y0 < 32 or x1 > page.rect.width-32 or y1 > page.rect.height-31:
                    boundary_warnings.append({"slide":i+1, "text":span["text"], "bbox":[x0,y0,x1,y1]})
    for j, first in enumerate(spans):
        for second in spans[j+1:]:
            if first["text"] == second["text"]:
                continue
            ax0,ay0,ax1,ay1 = first["bbox"]
            bx0,by0,bx1,by1 = second["bbox"]
            ix = min(ax1,bx1) - max(ax0,bx0)
            iy = min(ay1,by1) - max(ay0,by0)
            if ix > 2 and iy > 0.6:
                overlap_warnings.append({
                    "slide":i+1, "first":first["text"], "second":second["text"],
                    "intersection_width_pt":round(ix,2), "intersection_height_pt":round(iy,2)
                })
ns = {"a":"http://schemas.openxmlformats.org/drawingml/2006/main"}
with zipfile.ZipFile(pptx_path) as z:
    slides = [n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
    notes = [n for n in z.namelist() if re.fullmatch(r"ppt/notesSlides/notesSlide\d+\.xml", n)]
    assert len(slides) == len(notes) == 10
    for name in slides + notes:
        root = ET.fromstring(z.read(name))
        content = " ".join(n.text or "" for n in root.findall(".//a:t", ns))
        assert snapshot in content, f"Snapshot missing in {name}"
    all_notes = "\n".join(z.read(n).decode() for n in notes)
    assert "Exact revenue scenario" in all_notes and "Exact gross-profit scenario" in all_notes
    assert "Gross-profit formula" in all_notes and "TALK TRACK" in all_notes

thumb_w = 640
thumb_h = 360
gutter = 24
label_h = 30
sheet = Image.new("RGB", (gutter+2*(thumb_w+gutter), gutter+5*(thumb_h+label_h+gutter)), "#FAF6EF")
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.load_default(size=19)
except TypeError:
    font = ImageFont.load_default()
for i, file in enumerate(image_paths):
    x = gutter + (i%2)*(thumb_w+gutter)
    y = gutter + (i//2)*(thumb_h+label_h+gutter)
    image = Image.open(file).convert("RGB")
    image.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
    sheet.paste(image, (x,y))
    draw.text((x,y+thumb_h+6), f"{i+1:02d} / 10", fill="#6D2E46", font=font)
contact = qa / "contact-sheet.png"
sheet.save(contact)
print(json.dumps({
    "pdf_pages":len(doc), "pptx_slides":10, "notes_slides":10,
    "source_id_on_every_slide":True, "source_id_in_every_notes_page":True,
    "contact_sheet":str(contact), "slide_pngs":image_paths,
    "text_boundary_warnings":boundary_warnings,
    "text_overlap_warnings":overlap_warnings,
    "visual_review":"Rendered for initial author inspection and independent parent-arranged QA."
}))
`;
  const rendering = spawnSync('python', [
    '-c', script, path.relative(ROOT, PPTX), path.relative(ROOT, PDF),
    path.relative(ROOT, QA), review.snapshot_id,
  ], { cwd: ROOT, encoding: 'utf8', timeout: 120000, windowsHide: true });
  if (rendering.error) throw rendering.error;
  if (rendering.status !== 0) {
    throw new Error(`Rendering or content validation failed:\n${rendering.stderr}\n${rendering.stdout}`);
  }
  return JSON.parse(rendering.stdout.trim());
}

function portablePreview(preview) {
  const { contact_sheet, slide_pngs, error, ...checks } = preview;
  return {
    ...checks,
    default_qa_directory: path.join('presentation', '.preview'),
    qa_directory_overridden: Boolean(process.env.DECK_QA_DIR),
    ...(preview.status === 'rendered' ? {
      qa_artifact_names: {
        contact_sheet: path.basename(contact_sheet),
        slide_pngs: slide_pngs.map(file => path.basename(file)),
      },
    } : {}),
    ...(error ? {
      error: 'Preview conversion or rendering failed; environment-specific details are in the console output.',
    } : {}),
  };
}

async function main() {
  fs.mkdirSync(relative(path.dirname(PPTX)), { recursive: true });
  await pptx.writeFile({ fileName: relative(PPTX), compression: true });
  let preview = { status: 'not requested (--pptx-only)' };
  let previewError;
  if (!process.argv.includes('--pptx-only')) {
    try {
      preview = { status: 'rendered', ...runPreview() };
    } catch (error) {
      previewError = error;
      preview = { status: 'failed', error: error.message };
    }
  }
  const manifest = {
    title: pptx.title,
    input: {
      file: 'outputs\\review.json', snapshot_id: review.snapshot_id,
      sha256: sourceHash, generated: review.generated,
    },
    build_command: 'node presentation\\build_deck.cjs',
    authoring_dependency: `PptxGenJS ${pptx.version}; build-time only`,
    editable_content: 'Native text/shapes on every slide; the shared architecture is the single image.',
    layout: { name: 'LAYOUT_WIDE', width_inches: W, height_inches: H },
    palette: C,
    fonts: FONT,
    selected_product_ids: chosen.map(x => x.product_id),
    summary,
    slide_count: pages.length,
    suggested_talk_seconds: pages.reduce((sum, x) => sum + x.seconds, 0),
    output: {
      pptx: 'outputs\\business_review.pptx', pptx_sha256: sha256(PPTX),
      pdf: fs.existsSync(PDF) ? 'outputs\\business_review.pdf' : null,
      ...(fs.existsSync(PDF) ? { pdf_sha256: sha256(PDF) } : {}),
    },
    preview: portablePreview(preview),
    slides: pages,
  };
  fs.writeFileSync(relative(MANIFEST), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Built ${relative(PPTX)} (${pages.length} slides; snapshot ${review.snapshot_id}).`);
  if (preview.status === 'rendered') {
    console.log(`Rendered ${relative(PDF)}. QA contact sheet: ${path.join(QA, 'contact-sheet.png')}`);
    console.log(`Text-boundary warnings: ${preview.text_boundary_warnings.length}.`);
    console.log(`Rendered text-overlap warnings: ${preview.text_overlap_warnings.length}.`);
  }
  if (previewError) throw previewError;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
