/* Build-time only: node presentation\build_deck.cjs
 * --pptx-only omits the optional LibreOffice/Python preview.
 * DECK_QA_DIR overrides presentation\.preview for temporary render artifacts.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const PptxGenJS = require("pptxgenjs");
const artifactSha256 = require("./artifact_sha256.cjs");

const ROOT = path.resolve(__dirname, "..");
const REVIEW = path.join(ROOT, "outputs", "review.json");
const ARCHITECTURE = path.join(ROOT, "architecture", "production.json");
const ARCH_IMAGE = path.join(ROOT, "architecture", "production.png");
const ARCH_RENDER = path.join(ROOT, "architecture", "production.render.json");
const PPTX = path.join(ROOT, "outputs", "business_review.pptx");
const PDF = path.join(ROOT, "outputs", "business_review.pdf");
const MANIFEST = path.join(ROOT, "presentation", "deck_manifest.json");
const QA = process.env.DECK_QA_DIR
  ? path.resolve(ROOT, process.env.DECK_QA_DIR) : path.join(ROOT, "presentation", ".preview");
const REPO = "https://github.com/glejdis/zenline-category-opportunity-review";
const DEMO = "https://glejdis.github.io/zenline-category-opportunity-review/";
const W = 13.333333, H = 7.5, M = 0.55;
const C = {
  ink: "30282E", dark: "2C252B", berry: "6D2E46", berryDark: "502737",
  rose: "BD8192", roseLight: "E6BFCA", blush: "F0DFE3", ivory: "FAF6EF",
  paper: "FFFDFA", taupe: "E4DAD4", muted: "6F6268", darkMuted: "D1BFC6",
};
const FONT = { heading: "Calibri", body: "Calibri" };
const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const review = readJson(REVIEW);
const arch = readJson(ARCHITECTURE);
const archRender = readJson(ARCH_RENDER);
const summary = review.summary;
const chosen = review.recommendations;
const sourceHash = sha256(REVIEW);
const asOf = new Date(`${review.generated}T12:00:00Z`);
const dateText = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
}).format(asOf);
const shortDate = value => new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
}).format(new Date(`${value}T12:00:00Z`));
const number = value => Number(value).toLocaleString("en-GB");
const eur = (value, decimals = 2) => new Intl.NumberFormat("en-IE", {
  style: "currency", currency: "EUR",
  minimumFractionDigits: decimals, maximumFractionDigits: decimals,
}).format(value);
const eurK = (value, decimals = 1) => `€${(value / 1000).toFixed(decimals)}k`;
const rate = (value, decimals = 1) => `${(value * 100).toFixed(decimals)}%`;
const points = (value, decimals = 2) => `${value.toFixed(decimals)}%`;
const signedRate = value => `${value >= 0 ? "+" : ""}${rate(value)}`;
const stock = value => ({
  in_stock: "In stock", out_of_stock: "Out of stock", low_stock: "Low stock",
}[value] || value);

assert.equal(review.schema_version, 2, "Review schema changed; recheck deck mappings.");
assert.ok(/^[0-9a-f]+$/i.test(review.snapshot_id), "A review snapshot ID is required.");
assert.equal(chosen.length, 5, "This narrative requires five actual selected decisions.");
assert.equal(review.landscape.length, summary.n_skus);
assert.equal(review.opportunities.length, summary.n_flagged);
assert.equal(Object.values(summary.action_counts).reduce((a, b) => a + b, 0), summary.n_flagged);
assert.equal(archRender.text_hash_normalization, "utf8-lf");
for (const [field, filename] of [
  ["source_sha256", "production.mmd"], ["svg_sha256", "production.svg"], ["png_sha256", "production.png"],
]) {
  assert.equal(artifactSha256(path.join(ROOT, "architecture", filename)), archRender[field],
    `Architecture ${filename} changed; rebuild the shared diagram.`);
}
for (const [type, key] of [["Revenue", "revenue_scenario_eur"], ["Gross profit", "gross_profit_scenario_eur"]]) {
  const actual = review.opportunities.filter(item => item.scenario.value_type === type)
    .reduce((total, item) => total + (item.scenario.value_eur || 0), 0);
  assert.ok(Math.abs(actual - summary[key]) < 0.011, `${type} scenario total is inconsistent.`);
}

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "ZenBeauty Retail category opportunity review";
pptx.subject = "Decision-led business review: validate first, pilot selectively, scale on evidence";
pptx.title = "Validate first. Pilot selectively. Scale on evidence.";
pptx.company = "ZenBeauty Retail — fictional case study";
pptx.lang = "en-GB";
pptx.theme = { headFontFace: FONT.heading, bodyFontFace: FONT.body, lang: "en-GB" };
const S = pptx.ShapeType;
const pages = [];
const pageInfo = new WeakMap();

function remember(slide, kind, x, y, w, h, value) {
  assert.ok([x, y, w, h].every(Number.isFinite), `Non-finite ${kind} geometry`);
  assert.ok(w >= 0 && h >= 0 && x >= -0.001 && y >= -0.001
    && x + w <= W + 0.001 && y + h <= H + 0.001, `${kind} outside slide bounds`);
  pageInfo.get(slide).elements.push({
    kind, x, y, w, h, ...(value === undefined ? {} : { text: value }),
  });
}

function text(slide, value, x, y, w, h, options = {}) {
  remember(slide, "text", x, y, w, h, typeof value === "string" ? value : value.map(run => run.text).join(""));
  slide.addText(value, {
    x, y, w, h, fontFace: FONT.body, fontSize: 18, color: C.ink,
    margin: 0, breakLine: false, valign: "mid",
    paraSpaceAfter: 0, paraSpaceBefore: 0, fit: "none", ...options,
  });
}

function shape(slide, kind, x, y, w, h, fill, options = {}) {
  remember(slide, "shape", x, y, w, h);
  slide.addShape(kind, {
    x, y, w, h, line: { color: fill, transparency: 100 }, fill: { color: fill }, ...options,
  });
}

function panel(slide, x, y, w, h, fill = C.paper) {
  shape(slide, S.roundRect, x, y, w, h, fill, { radius: 0.12, rectRadius: 0.12 });
}

function badge(slide, value, x, y, size = 0.48, fill = C.berry, color = C.paper) {
  shape(slide, S.ellipse, x, y, size, size, fill);
  text(slide, value, x, y, size, size, {
    fontSize: value.length > 1 ? 13 : 17, bold: true, align: "center", color,
  });
}

function line(slide, x, y, w, h, color, width = 1.2) {
  remember(slide, "line", x, y, w, h);
  slide.addShape(S.line, { x, y, w, h, line: { color, width } });
}

function sourceIcon(slide, kind, x, y) {
  badge(slide, "", x, y, 0.68, C.blush);
  if (kind === "sales") {
    [0.18, 0.30, 0.43].forEach((height, i) =>
      shape(slide, S.rect, x + 0.16 + i * 0.13, y + 0.49 - height, 0.085, height, C.berry));
  } else if (kind === "product") {
    shape(slide, S.roundRect, x + 0.205, y + 0.12, 0.27, 0.43, C.berry, { rectRadius: 0.03 });
    shape(slide, S.rect, x + 0.265, y + 0.09, 0.15, 0.06, C.berry);
    shape(slide, S.rect, x + 0.255, y + 0.30, 0.17, 0.075, C.ivory);
  } else {
    [0.20, 0.35, 0.50].forEach((cx, i) =>
      shape(slide, S.ellipse, x + cx - 0.065, y + 0.28 - i * 0.04, 0.13, 0.13, C.berry));
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
  text(slide, `${String(meta.number).padStart(2, "0")} / 10`, 12.20, 6.815, 0.58, 0.20, {
    fontSize: 10.5, color: dark ? C.darkMuted : C.muted, align: "right",
  });
  return slide;
}

function heading(slide, title, subtitle, size = 34) {
  text(slide, "ZENBEAUTY RETAIL  /  CATEGORY REVIEW", M, 0.50, 10.5, 0.19, {
    fontSize: 10.5, color: C.berry, bold: true, charSpacing: 1.3,
  });
  text(slide, title, M, 0.89, 12.23, 0.66, {
    fontFace: FONT.heading, fontSize: size, color: C.ink, bold: true,
  });
  if (subtitle) text(slide, subtitle, M, 1.67, 12.13, 0.40, { fontSize: 17.5, color: C.muted });
}

function notes(slide, seconds, talkTrack, evidence) {
  const meta = pageInfo.get(slide);
  const content = [
    `${meta.number}. ${meta.title}`,
    `Suggested speaking time: ${seconds} seconds. Main discussion: approximately 8–9 minutes; two appendix slides support questions.`,
    "", "TALK TRACK", talkTrack, "", "SOURCE AND REPRODUCIBILITY",
    "Authoritative build input: outputs\\review.json (local file; public main may lag).",
    `Snapshot ID: ${review.snapshot_id}`, `Review generated/as-of date: ${review.generated}`,
    `review.json SHA-256: ${sourceHash}`,
    "Inputs are synthetic. No result, task assignment or commercial action is approved or executed by this deck.",
    `Public repository: ${REPO}`, `Public dashboard (last deployed commit): ${DEMO}`,
    "", "EVIDENCE, DEFINITIONS AND LIMITS",
    typeof evidence === "string" ? evidence : JSON.stringify(evidence, null, 2),
  ].join("\n");
  slide.addNotes(content);
  meta.seconds = seconds;
  meta.speaker_notes = content;
}

function sourceRows(item) {
  return item.source_refs.map(ref => `${ref.file}: ${ref.record_id}, CSV row ${ref.row_number}`).join("\n");
}

function fullDecisionEvidence(item) {
  return [
    `${item.product_id} — ${item.product_name}`,
    `Primary action: ${item.primary_action}; also flagged: ${item.also_flagged.join(", ") || "none"}`,
    `Proposed owner: ${item.suggested_owner}`, `Next step: ${item.next_step}`,
    `Success measure: ${item.success_measure}`,
    `Status: ${item.status}; stock: ${item.stock_status}; seasonality: ${item.seasonality}`,
    `12-week revenue ${eur(item.channel_revenue_eur_12w)}; units ${number(item.channel_units_12w)}; margin ${rate(item.channel_margin_pct)}`,
    `Market proxy ${eur(item.market_revenue_eur_12w)}; trend ${signedRate(item.market_trend_12w_pct)}`,
    `Channel/proxy ratio ${points(item.channel_to_market_ratio_pct, 8)}; peer ratio ${points(item.peer_ratio_pct, 8)}; peer margin ${rate(item.peer_margin_pct, 3)}`,
    `Peers (${item.peer_count}; subject excluded): ${item.peer_ids.join(", ")}`,
    `Scenario: ${JSON.stringify(item.scenario)}`, `Caveats: ${item.caveats.join(" ")}`,
    "Source records:", sourceRows(item),
  ].join("\n");
}

function shortName(item) {
  const known = {
    HC0070: ["Wella Blondor Light Blonde", "Wella Blondor · Light Blonde"],
    HC0002: ["ZenBeauty Private Label Color Studio Sunlit Peach", "Private label · Sunlit Peach"],
    HC0101: ["Bleach London White Toner Cool Ash Blonde", "Bleach London · White Toner"],
    HC0024: ["Herbatint Permanent Herbal Color Natural Black", "Herbatint · Natural Black"],
    HC0083: ["Madison Reed Root Touch Up Pearl Blonde", "Madison Reed · Root Touch Up"],
  };
  const match = known[item.product_id];
  return match && match[0] === item.product_name ? match[1] : item.product_name;
}

function decisionRow(item) {
  const availability = stock(item.stock_status);
  const proxy = `${eurK(item.market_revenue_eur_12w)} market proxy`;
  switch (item.primary_action) {
    case "Fix availability":
      return { evidence: `${availability} · ${proxy}\nMarket trend ${signedRate(item.market_trend_12w_pct)}`, action: "Validate stock and lead time", owner: item.suggested_owner };
    case "Investigate zero sales":
      return { evidence: `${availability} · ${eur(item.channel_revenue_eur_12w, 0)} sales / ${number(item.channel_units_12w)} units\n${proxy} · ${signedRate(item.market_trend_12w_pct)} · ${item.seasonality}`, action: "Check listing, feed and season", owner: item.suggested_owner.replace("operations", "ops") };
    case "Review reactivation":
      return { evidence: `Inactive · ${proxy}\nMarket trend ${signedRate(item.market_trend_12w_pct)} · reason unknown`, action: "Understand inactivity first", owner: item.suggested_owner };
    case "Review margin":
      return { evidence: `${rate(item.channel_margin_pct)} margin · ${eurK(item.channel_revenue_eur_12w)} revenue\n${item.stock_status === "in_stock" ? "Validate costs before a price change" : `Also ${availability.toLowerCase()}—check supply first`}`, action: "Validate cost / terms and supply", owner: item.suggested_owner };
    case "Test promotion":
      return { evidence: `${availability} · channel / proxy ${points(item.channel_to_market_ratio_pct)}\nPeer ratio ${points(item.peer_ratio_pct)}—comparison, not share`, action: "Small test with baseline / control", owner: item.suggested_owner.replace(" manager", "") };
    default:
      throw new Error(`No reviewed business-language layout for ${item.primary_action}.`);
  }
}

const strategicMetrics = require("./strategy_story.cjs")({
  pptx, review, summary, chosen, arch, archRender, ARCH_IMAGE, ARCHITECTURE,
  REPO, DEMO, W, H, M, C, FONT, S, fs, sha256, pages, pageInfo,
  text, shape, panel, badge, line, sourceIcon, newSlide, heading, notes,
  sourceRows, fullDecisionEvidence, shortName, decisionRow,
  number, eur, eurK, rate, points, signedRate, stock, dateText, shortDate, remember,
});
assert.equal(pages.length, 10);
assert.ok(pages.every(page => page.speaker_notes.includes(review.snapshot_id)));
assert.ok(pages.every(page => page.elements.some(element => element.kind === "shape" || element.kind === "image")));

function runPreview() {
  const soffice = process.platform === "win32"
    ? "C:\\Program Files\\LibreOffice\\program\\soffice.exe" : "soffice";
  if (process.platform === "win32" && !fs.existsSync(soffice)) throw new Error("LibreOffice is required for the optional PDF preview.");
  fs.mkdirSync(QA, { recursive: true });
  const profile = fs.mkdtempSync(path.join(QA, "lo-profile-"));
  if (fs.existsSync(PDF)) fs.unlinkSync(PDF);
  let conversion;
  try {
    conversion = spawnSync(soffice, [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--headless", "--nologo", "--nodefault", "--nofirststartwizard",
      "--convert-to", "pdf:impress_pdf_Export", "--outdir", path.join(ROOT, "outputs"), PPTX,
    ], { cwd: ROOT, encoding: "utf8", timeout: 120000, windowsHide: true });
    if (conversion.error) throw conversion.error;
    if (conversion.status !== 0 || !fs.existsSync(PDF)) {
      throw new Error(`LibreOffice preview failed: ${conversion.stderr || conversion.stdout || conversion.status}`);
    }
  } finally {
    if (!conversion || !conversion.error) fs.rmSync(profile, { recursive: true, force: true });
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
assert len(doc) == 10
image_paths, boundary_warnings, overlap_warnings = [], [], []
for i, page in enumerate(doc):
    content = page.get_text("text")
    assert snapshot in content, f"Missing snapshot footer on page {i+1}"
    assert not re.search(r"lorem ipsum|xxxx|TODO|TBD", content, re.I)
    assert "\ufffd" not in content
    pix = page.get_pixmap(matrix=pymupdf.Matrix(160/72, 160/72), alpha=False)
    destination = qa / f"slide-{i+1:02d}.png"
    pix.save(str(destination))
    image_paths.append(str(destination))
    spans = [span for block in page.get_text("dict")["blocks"] for line in block.get("lines", []) for span in line.get("spans", []) if span.get("text", "").strip()]
    for span in spans:
        x0,y0,x1,y1 = span["bbox"]
        if x0 < 33 or y0 < 32 or x1 > page.rect.width-32 or y1 > page.rect.height-31:
            boundary_warnings.append({"slide":i+1,"text":span["text"],"bbox":span["bbox"]})
    for j, first in enumerate(spans):
        for second in spans[j+1:]:
            ax0,ay0,ax1,ay1 = first["bbox"]; bx0,by0,bx1,by1 = second["bbox"]
            ix,iy = min(ax1,bx1)-max(ax0,bx0),min(ay1,by1)-max(ay0,by0)
            if first["text"] != second["text"] and ix > 2 and iy > 0.6:
                overlap_warnings.append({"slide":i+1,"first":first["text"],"second":second["text"],"intersection_width_pt":round(ix,2),"intersection_height_pt":round(iy,2)})
ns = {"a":"http://schemas.openxmlformats.org/drawingml/2006/main"}
with zipfile.ZipFile(pptx_path) as archive:
    slides=[name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml",name)]
    notes=[name for name in archive.namelist() if re.fullmatch(r"ppt/notesSlides/notesSlide\d+\.xml",name)]
    assert len(slides) == len(notes) == 10
    for name in slides + notes:
        root=ET.fromstring(archive.read(name))
        assert snapshot in " ".join(node.text or "" for node in root.findall(".//a:t",ns)), name
    all_notes="\n".join(archive.read(name).decode() for name in notes)
    for required in ["Exact revenue scenario","Exact gross-profit scenario","Gross-profit formula","TALK TRACK"]:
        assert required in all_notes,required
thumb_w,thumb_h,gutter,label_h=640,360,24,30
sheet=Image.new("RGB",(gutter+2*(thumb_w+gutter),gutter+5*(thumb_h+label_h+gutter)),"#FAF6EF")
draw=ImageDraw.Draw(sheet)
try:
    font=ImageFont.load_default(size=19)
except TypeError:
    font=ImageFont.load_default()
for i,file in enumerate(image_paths):
    x,y=gutter+(i%2)*(thumb_w+gutter),gutter+(i//2)*(thumb_h+label_h+gutter)
    image=Image.open(file).convert("RGB")
    image.thumbnail((thumb_w,thumb_h),Image.Resampling.LANCZOS)
    sheet.paste(image,(x,y)); draw.text((x,y+thumb_h+6),f"{i+1:02d} / 10",fill="#6D2E46",font=font)
contact=qa/"contact-sheet.png";sheet.save(contact)
print(json.dumps({"pdf_pages":len(doc),"pptx_slides":10,"notes_slides":10,
    "source_id_on_every_slide":True,"source_id_in_every_notes_page":True,
    "contact_sheet":str(contact),"slide_pngs":image_paths,
    "text_boundary_warnings":boundary_warnings,"text_overlap_warnings":overlap_warnings,
    "visual_review":"Rendered for author inspection and independent visual review."}))
`;
  const rendered = spawnSync("python", [
    "-c", script, PPTX, PDF, QA, review.snapshot_id,
  ], { cwd: ROOT, encoding: "utf8", timeout: 120000, windowsHide: true });
  if (rendered.error) throw rendered.error;
  if (rendered.status !== 0) throw new Error(`Rendering/content validation failed:\n${rendered.stderr}\n${rendered.stdout}`);
  return JSON.parse(rendered.stdout.trim());
}

function portablePreview(preview) {
  const { contact_sheet, slide_pngs, error, ...checks } = preview;
  return {
    ...checks, default_qa_directory: path.join("presentation", ".preview"),
    qa_directory_overridden: Boolean(process.env.DECK_QA_DIR),
    ...(preview.status === "rendered" ? { qa_artifact_names: {
      contact_sheet: path.basename(contact_sheet), slide_pngs: slide_pngs.map(file => path.basename(file)),
    } } : {}),
    ...(error ? { error: "Preview failed; environment-specific details are in the console output." } : {}),
  };
}

async function main() {
  fs.mkdirSync(path.dirname(PPTX), { recursive: true });
  await pptx.writeFile({ fileName: PPTX, compression: true });
  let preview = { status: "not requested (--pptx-only)" }, previewError;
  if (!process.argv.includes("--pptx-only")) {
    try { preview = { status: "rendered", ...runPreview() }; }
    catch (error) { previewError = error; preview = { status: "failed", error: error.message }; }
  }
  fs.writeFileSync(MANIFEST, JSON.stringify({
    title: pptx.title,
    input: { file: "outputs\\review.json", snapshot_id: review.snapshot_id, sha256: sourceHash, generated: review.generated },
    build_command: "node presentation\\build_deck.cjs",
    authoring_dependency: `PptxGenJS ${pptx.version}; build-time only`,
    editable_content: "Native text/shapes on every slide; the unchanged shared architecture is the only image.",
    layout: { name: "LAYOUT_WIDE", width_inches: W, height_inches: H }, palette: C, fonts: FONT,
    selected_product_ids: chosen.map(item => item.product_id), summary, strategic_metrics: strategicMetrics,
    storyline: "Eight decision-led main slides; methodology and the existing Azure design are appendices.",
    slide_count: pages.length, suggested_talk_seconds: pages.reduce((sum, page) => sum + page.seconds, 0),
    output: {
      pptx: "outputs\\business_review.pptx", pptx_sha256: sha256(PPTX),
      pdf: fs.existsSync(PDF) ? "outputs\\business_review.pdf" : null,
      ...(fs.existsSync(PDF) ? { pdf_sha256: sha256(PDF) } : {}),
    },
    preview: portablePreview(preview), slides: pages,
  }, null, 2) + "\n", "utf8");
  console.log(`Built ${path.relative(ROOT, PPTX)} (${pages.length} slides; snapshot ${review.snapshot_id}).`);
  if (preview.status === "rendered") {
    console.log(`Rendered ${path.relative(ROOT, PDF)}. QA contact sheet: ${path.join(QA, "contact-sheet.png")}`);
    console.log(`Text-boundary warnings: ${preview.text_boundary_warnings.length}.`);
    console.log(`Rendered text-overlap warnings: ${preview.text_overlap_warnings.length}.`);
  }
  if (previewError) throw previewError;
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
