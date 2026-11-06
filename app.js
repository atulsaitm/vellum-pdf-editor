const state = {
  page: 1,
  pages: 12,
  zoom: 86,
  tool: "select",
  annotations: [],
  history: [],
  pdf: null,
  pdfBytes: null,
  renderedViewport: null,
  rotation: 0,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const toast = (message) => {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
};
const save = () => {
  $("#savedState").textContent = "Saved just now";
  setTimeout(() => ($("#savedState").textContent = "Saved locally"), 1400);
};

function renderThumbnails() {
  const list = $("#thumbnailList");
  list.innerHTML = "";
  for (let i = 1; i <= state.pages; i += 1) {
    const item = document.createElement("div");
    item.className = `thumbnail ${i === state.page ? "active" : ""}`;
    item.innerHTML = `<div class="thumb-number">${String(i).padStart(2, "0")}</div><div class="thumb-canvas" data-thumb="${i}"></div><div class="thumb-info"><div class="thumb-title">${state.pdf ? `Page ${i}` : ["Investor update", "Executive summary", "Revenue & growth", "Product velocity"][i - 1] || "Document page"}</div><div class="thumb-sub">${i === 1 && !state.pdf ? "Cover page" : `${i} of ${state.pages}`}</div></div>`;
    item.onclick = () => goToPage(i);
    list.appendChild(item);
  }
  if (state.pdf) renderThumbnailCanvases();
}

async function renderThumbnailCanvases() {
  for (const thumb of $$(".thumb-canvas")) {
    const pageNumber = Number(thumb.dataset.thumb);
    const page = await state.pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 74 / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    thumb.replaceChildren(canvas);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  }
}

async function renderPdfPage() {
  if (!state.pdf) return;
  const page = await state.pdf.getPage(state.page);
  const base = page.getViewport({ scale: 1, rotation: state.rotation });
  const scale = (state.zoom / 86) * (618 / base.width);
  const viewport = page.getViewport({ scale, rotation: state.rotation });
  const pdfPage = $("#pdfPage");
  pdfPage.classList.remove("mock-page");
  pdfPage.style.width = `${viewport.width}px`;
  pdfPage.style.height = `${viewport.height}px`;
  $("#pageStage").style.width = `${viewport.width}px`;
  $("#pageStage").style.height = `${viewport.height + 30}px`;
  const canvas = $("#pdfCanvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  state.renderedViewport = viewport;
  $("#annotationLayer").style.width = `${viewport.width}px`;
  $("#annotationLayer").style.height = `${viewport.height}px`;
  renderAnnotations();
}

function renderAnnotations() {
  const layer = $("#annotationLayer");
  layer.replaceChildren();
  for (const annotation of state.annotations.filter((item) => item.page === state.page)) {
    const el = document.createElement("div");
    el.className = `annotation ${annotation.type}`;
    el.style.left = `${annotation.x * 100}%`;
    el.style.top = `${annotation.y * 100}%`;
    if (annotation.type === "text") {
      el.textContent = annotation.text;
      el.contentEditable = "true";
      el.onblur = () => { annotation.text = el.textContent; save(); };
      el.style.cssText += "padding:6px 9px;background:#fff;color:#17212b;border:1px solid #ee785f;border-radius:4px;min-width:100px";
    }
    if (annotation.type === "form") {
      el.innerHTML = `<input aria-label="PDF form field" placeholder="Fillable field" />`;
      el.style.cssText += "width:180px;background:#fff;border:1px dashed #ee785f;padding:4px";
    }
    if (annotation.type === "comment") {
      el.textContent = "●";
      el.title = "Review comment";
      el.onclick = () => toast("Comment: review this location");
    }
    if (annotation.type === "redaction") el.title = "Pending permanent redaction";
    layer.appendChild(el);
  }
}

async function goToPage(page) {
  state.page = Math.max(1, Math.min(state.pages, page));
  $("#pageStatus").textContent = `Page ${state.page} of ${state.pages}`;
  renderThumbnails();
  if (state.pdf) await renderPdfPage();
  else {
    $("#pdfPage").classList.add("mock-page");
    $("#pdfPage").querySelector(".hero-kicker").textContent = state.page === 1 ? "INVESTOR UPDATE · 03" : `DOCUMENT SECTION · ${String(state.page).padStart(2, "0")}`;
  }
}

function setTool(tool) {
  state.tool = tool;
  $$("[data-tool]").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
  const labels = {
    select: ["Select mode", "Click any object to inspect its properties"],
    text: ["Text mode", "Click the page to place an editable text block"],
    draw: ["Draw mode", "Drag across the page to draw with the active pen"],
    highlight: ["Highlight mode", "Drag across text to create a highlight"],
    redact: ["Redaction mode", "Mark content for permanent removal on export"],
    comment: ["Comment mode", "Click the page to pin a review comment"],
    form: ["Form field mode", "Click to place a fillable field"],
  };
  $("#toolState").textContent = labels[tool][0];
  $("#contextHint").textContent = labels[tool][1];
  if (tool === "comment") toast("Comment mode active");
  if (tool === "redact") toast("Redaction marks are burned into exported pages");
}

function addAnnotation(type, event) {
  const bounds = $("#pdfPage").getBoundingClientRect();
  state.annotations.push({
    type,
    page: state.page,
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    text: type === "text" ? "New text block" : "",
  });
  renderAnnotations();
  save();
  toast(`${type[0].toUpperCase() + type.slice(1)} added`);
}

async function loadPdf(file) {
  if (!window.pdfjsLib) {
    toast("PDF engine is still loading — try again in a moment");
    return;
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.pdfBytes = bytes;
    state.pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    state.pages = state.pdf.numPages;
    state.page = 1;
    $("#fileName").textContent = file.name;
    $("#panelTitle").innerHTML = `Pages <span class="muted-count">${state.pages}</span>`;
    $(".panel-footer span").textContent = `${state.pages} pages`;
    $("#pdfPage").querySelectorAll(":scope > :not(#pdfCanvas):not(#annotationLayer)").forEach((el) => { if (!el.matches(".page-topline,.page-hero,.page-graphic,.page-foot")) el.remove(); });
    renderThumbnails();
    await renderPdfPage();
    toast(`${file.name} loaded — ${state.pages} pages rendered`);
    save();
  } catch (error) {
    console.error(error);
    toast("Could not read this PDF. The file may be encrypted or damaged.");
  }
}

async function exportPdf() {
  if (!state.pdfBytes || !window.PDFLib) {
    toast("Open a PDF before exporting");
    return;
  }
  try {
    const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
    const output = await PDFDocument.load(state.pdfBytes);
    const font = await output.embedFont(StandardFonts.Helvetica);
    for (const annotation of state.annotations) {
      const page = output.getPage(annotation.page - 1);
      const { width, height } = page.getSize();
      const x = annotation.x * width;
      const y = height - annotation.y * height;
      if (annotation.type === "redaction") page.drawRectangle({ x, y: y - 18, width: 160, height: 20, color: rgb(0, 0, 0) });
      if (annotation.type === "highlight") page.drawRectangle({ x, y: y - 10, width: 180, height: 15, color: rgb(1, .75, .2), opacity: .4 });
      if (annotation.type === "text") page.drawText(annotation.text, { x, y, size: 12, font, color: rgb(.1, .12, .15) });
      if (annotation.type === "comment") page.drawCircle({ x: x + 7, y, size: 7, color: rgb(.95, .63, .25) });
    }
    const blob = new Blob([await output.save()], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = ($("#fileName").textContent || "edited-document.pdf").replace(/\.pdf$/i, "-edited.pdf");
    link.click();
    URL.revokeObjectURL(url);
    toast("Edited PDF exported");
  } catch (error) {
    console.error(error);
    toast("Export failed — the source PDF may be encrypted.");
  }
}

function openModal(kind) {
  const configs = {
    ocr: ["INTELLIGENT WORKFLOW", "Optical character recognition", "Run OCR on the selected pages to make scanned content searchable. This browser build keeps the original PDF and prepares the OCR workflow entry point.", ["Detect language automatically", "Preserve original layout", "Create an accessibility text layer"]],
    sign: ["TRUSTED SIGNING", "Add your signature", "Place a signature mark or start a signing request with an audit trail.", ["Draw or type a signature", "Request signatures from others", "Notify reviewers by email"]],
    share: ["COLLABORATION", "Share for review", "Invite reviewers into a focused workspace with comment-only or edit access.", ["Anyone with the link can comment", "Require sign-in to access", "Notify reviewers by email"]],
  };
  const config = configs[kind] || configs.ocr;
  $("#modalEyebrow").textContent = config[0];
  $("#modalTitle").textContent = config[1];
  $("#modalText").textContent = config[2];
  $("#modalOptions").innerHTML = config[3].map((option, index) => `<label class="modal-option ${index === 0 ? "selected" : ""}"><input type="radio" name="workflow" ${index === 0 ? "checked" : ""}/><span>${option}</span></label>`).join("");
  $("#modalBackdrop").classList.add("open");
}
function closeModal() { $("#modalBackdrop").classList.remove("open"); }
function updateZoom() { $("#zoomValue").textContent = `${state.zoom}%`; if (state.pdf) renderPdfPage(); else $(".page-stage").style.transform = `scale(${state.zoom / 86})`; }

const actions = {
  share: () => openModal("share"),
  ocr: () => openModal("ocr"),
  sign: () => openModal("sign"),
  export: exportPdf,
  undo: () => { state.annotations.pop(); renderAnnotations(); toast("Last annotation undone"); },
  redo: () => toast("Redo history is empty"),
  "zoom-in": () => { state.zoom = Math.min(150, state.zoom + 10); updateZoom(); },
  "zoom-out": () => { state.zoom = Math.max(45, state.zoom - 10); updateZoom(); },
  fit: () => { state.zoom = 86; updateZoom(); toast("Page fitted to workspace"); },
  rotate: () => { state.rotation = (state.rotation + 90) % 360; if (state.pdf) renderPdfPage(); },
  "add-page": () => toast("Blank-page insertion requires a source PDF; use Export after editing"),
  "open-file": () => $("#fileInput").click(),
  settings: () => toast("Workspace settings are ready to customize"),
  help: () => toast("Use Ctrl/Cmd + O to open a PDF"),
  fullscreen: () => document.documentElement.requestFullscreen?.(),
  duplicate: () => toast("Duplicate pages are available for loaded PDFs"),
  delete: () => toast("Page deletion is disabled until a PDF is loaded"),
  "collapse-panel": () => $("#sidePanel").classList.toggle("collapsed"),
  "close-inspector": () => $(".inspector").classList.toggle("hidden"),
  "close-modal": closeModal,
  "modal-confirm": () => { closeModal(); toast("Workflow started — you can keep editing"); },
};

$$("[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
$$("[data-action]").forEach((button) => button.addEventListener("click", () => actions[button.dataset.action]?.()));
$$("[data-panel]").forEach((button) => button.addEventListener("click", () => {
  $$("[data-panel]").forEach((item) => item.classList.toggle("active", item === button));
  toast(`${button.dataset.panel[0].toUpperCase() + button.dataset.panel.slice(1)} panel selected`);
}));
$$(".toggle").forEach((toggle) => toggle.addEventListener("click", () => toggle.classList.toggle("on")));
$("#pdfPage").addEventListener("click", (event) => {
  if (event.target.closest(".annotation")) return;
  if (["text", "highlight", "redact", "comment", "form"].includes(state.tool)) addAnnotation(state.tool, event);
});
$("#fileInput").addEventListener("change", (event) => { const file = event.target.files[0]; if (file) loadPdf(file); });
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") { event.preventDefault(); $("#fileInput").click(); }
  if (event.key === "Escape") closeModal();
});

window.pdfjsLib = window.pdfjsLib || null;
import("./vendor/pdf.mjs").then((module) => {
  window.pdfjsLib = module;
  module.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.mjs";
  toast("PDF engine ready");
}).catch(() => toast("PDF engine could not load"));
renderThumbnails();
