const fs = require("fs");
const PDFDocument = require("pdfkit");
const { formatServiceOrderDisplay } = require("../utils/serviceOrderDisplay");
const env = require("../../../specflow/config/env");
const path = require("path");
const os = require("os");

function getPuppeteerOrNull() {
  try {
    // optional dependency in some environments
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    return require("puppeteer");
  } catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND") return null;
    throw err;
  }
}

function launchBrowser(puppeteer) {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  return puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
}

function drawTitle(doc, text) {
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#111").text(text || "-", { underline: false });
  doc.moveDown(0.4);
}

function drawLine(doc, label, value) {
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#222")
    .text(`${label}: `, { continued: true })
    .font("Helvetica")
    .text(String(value || "-"));
}

function drawSection(doc, title, content) {
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#1f1f1f").text(title || "-");
  doc.moveDown(0.25);
  doc.font("Helvetica").fontSize(10).fillColor("#2a2a2a").text(String(content || "-"), {
    lineGap: 2
  });
}

function drawTable(doc, headers, rows) {
  const startX = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = Math.max(100, Math.floor(contentWidth / headers.length));
  const rowHeight = 20;

  function row(cells, header = false) {
    let x = startX;
    const y = doc.y;
    for (let index = 0; index < headers.length; index += 1) {
      const text = String(cells[index] || "-");
      doc.save();
      if (header) {
        doc.fillColor("#e7edf5").rect(x, y, colWidth, rowHeight).fill();
      }
      doc.strokeColor("#b7c2cf").rect(x, y, colWidth, rowHeight).stroke();
      doc.restore();
      doc
        .font(header ? "Helvetica-Bold" : "Helvetica")
        .fontSize(9)
        .fillColor("#1f1f1f")
        .text(text, x + 5, y + 6, { width: colWidth - 10, height: rowHeight - 6 });
      x += colWidth;
    }
    doc.y += rowHeight;
  }

  row(headers, true);
  (Array.isArray(rows) ? rows : []).forEach((cells) => row(cells, false));
}

function buildPdfBuffer(payload) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42, size: "A4" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const report = payload.report || {};
    const order = payload.order || {};
    const customer = payload.customer || {};
    const site = payload.site || {};

    drawTitle(doc, report.title || "Service Report");
    drawLine(doc, "Report Number", report.report_number);
    drawLine(doc, "Revision", report.revision);
    drawLine(doc, "Status", report.status);
    drawLine(doc, "Service Order", formatServiceOrderDisplay(order.service_order_code, order.year));
    drawLine(doc, "Customer", customer.name);
    drawLine(doc, "Site", site.site_name);
    drawLine(doc, "Issue Date", report.issue_date);
    drawLine(doc, "Last Modified", report.last_modified_at);

    drawTable(
      doc,
      ["Campo", "Valor"],
      [
        ["Prepared By", report.prepared_by],
        ["Reviewed By", report.reviewed_by],
        ["Approved By", report.approved_by]
      ]
    );

    const sections = Array.isArray(payload.sections) ? payload.sections : [];
    sections.forEach((section) => {
      const rawHtml = String(section.content_html || "");
      const normalizedText = rawHtml
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .trim();
      drawSection(doc, section.section_title, normalizedText || "-");
    });

    doc.addPage();
    drawTitle(doc, "Timesheet Diario");
    drawTable(
      doc,
      ["Data", "Tecnico", "Entrada Cliente", "Saida Cliente"],
      (payload.timesheet || []).map((item) => [
        item.activity_date,
        item.technician_name,
        item.check_in_client,
        item.check_out_client
      ])
    );

    drawSection(doc, "Descricao do Atendimento Tecnico", "");
    (payload.dailyLogs || []).forEach((item) => {
      const dailyLogContent = item.content ? htmlToPlainText(item.content) : "";
      drawSection(doc, `${item.activity_date} ${item.title || ""}`.trim(), dailyLogContent || item.notes || "-");
    });

    drawSection(doc, "Componentes", "");
    drawTable(
      doc,
      ["Categoria", "Descricao", "Part Number", "Qtd"],
      (payload.components || []).map((item) => [
        item.category,
        item.description,
        item.part_number,
        item.quantity
      ])
    );

    drawSection(doc, "Assinaturas", "");
    drawTable(
      doc,
      ["Tipo", "Nome", "Cargo", "Empresa"],
      (payload.signatures || []).map((item) => [
        item.signer_type,
        item.signer_name,
        item.signer_role,
        item.signer_company
      ])
    );

    doc.end();
  });
}

function htmlToPlainText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Pixels acima deste limite disparam a compressão
const IMAGE_COMPRESS_THRESHOLD_PX = 1200;
// Largura máxima após redimensionamento (mantém proporção)
const IMAGE_MAX_WIDTH_PX = 1200;

function getSharpOrNull() {
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    return require("sharp");
  } catch (_) {
    return null;
  }
}

async function compressImageBuffer(buffer, ext) {
  const sharp = getSharpOrNull();
  if (!sharp) return { buffer, mime: ext === "png" ? "image/png" : "image/jpeg" };

  try {
    const img = sharp(buffer);
    const meta = await img.metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;

    if (w <= IMAGE_COMPRESS_THRESHOLD_PX && h <= IMAGE_COMPRESS_THRESHOLD_PX) {
      // Imagem pequena — retorna original sem reprocessar
      const mime = ext === "png" ? "image/png" : "image/jpeg";
      return { buffer, mime };
    }

    // Redimensiona e comprime
    const pipeline = img.resize({ width: IMAGE_MAX_WIDTH_PX, withoutEnlargement: true });
    let outBuffer;
    let mime;
    if (ext === "png") {
      outBuffer = await pipeline.png({ compressionLevel: 8, adaptiveFiltering: true }).toBuffer();
      mime = "image/png";
    } else {
      outBuffer = await pipeline.jpeg({ quality: 75, mozjpeg: true }).toBuffer();
      mime = "image/jpeg";
    }
    return { buffer: outBuffer, mime };
  } catch (_) {
    return { buffer, mime: ext === "png" ? "image/png" : "image/jpeg" };
  }
}

const IMG_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
let previewStaticAssetsPromise = null;
let sharedBrowserPromise = null;
let activePdfJobs = 0;
const pdfQueue = [];
const DEFAULT_PDF_CONCURRENCY = Math.max(1, Math.min(4, Number.parseInt(process.env.REPORT_PDF_CONCURRENCY || "", 10) || Math.ceil((os.cpus() || []).length / 2) || 2));
const IMAGE_PRELOAD_CONCURRENCY = Math.max(1, Number.parseInt(process.env.REPORT_PDF_IMAGE_PRELOAD_CONCURRENCY || "4", 10) || 4);

function buildImageRouteMap() {
  return [
    { prefix: "/docs/report/img/", dir: path.join(process.cwd(), "docs", "report", "img") },
    { prefix: "/public/", dir: path.resolve(__dirname, "..", "..", "..", "specflow", "public") }
  ];
}

async function resolveImageFromPath(urlPath) {
  const routeMap = buildImageRouteMap();
  for (const route of routeMap) {
    if (urlPath.startsWith(route.prefix)) {
      const rel = decodeURIComponent(urlPath.slice(route.prefix.length));
      const filePath = path.join(route.dir, rel);
      try {
        await fs.promises.access(filePath, fs.constants.F_OK);
      } catch (_err) {
        return null;
      }
      const ext = path.extname(filePath).replace(".", "").toLowerCase();
      const mime = IMG_MIME[ext];
      if (!mime) return null;
      const raw = await fs.promises.readFile(filePath);
      if (ext === "svg") return { body: raw, mime };
      const compressExt = ext === "png" ? "png" : "jpeg";
      const { buffer, mime: outMime } = await compressImageBuffer(raw, compressExt);
      return { body: buffer, mime: outMime };
    }
  }
  return null;
}

// Pré-carrega e comprime todas as imagens referenciadas no HTML.
// Retorna um Map de URL-absoluta -> { body, mime } para uso síncrono no handler.
async function preloadImageCache(html, baseUrl) {
  const srcRegex = /src=(["'])([^"']+)\1/gi;
  const paths = new Set();
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = srcRegex.exec(html)) !== null) {
    const src = m[2];
    if (/^data:/i.test(src) || /^https?:\/\//i.test(src)) continue;
    if (src.startsWith("/")) paths.add(src);
  }

  const cache = new Map();
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const pathList = [...paths];
  let cursor = 0;
  async function worker() {
    while (cursor < pathList.length) {
      const index = cursor;
      cursor += 1;
      const urlPath = pathList[index];
      // eslint-disable-next-line no-await-in-loop
      const result = await resolveImageFromPath(urlPath);
      if (result) cache.set(base + urlPath, result);
    }
  }
  const workers = [];
  const workerCount = Math.min(IMAGE_PRELOAD_CONCURRENCY, pathList.length || 1);
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return cache;
}

async function loadPreviewStaticAssets() {
  if (!previewStaticAssetsPromise) {
    previewStaticAssetsPromise = Promise.all([
      fs.promises.readFile(path.resolve(__dirname, "..", "..", "..", "specflow", "public", "css", "report-preview.css"), "utf8"),
      fs.promises.readFile(path.resolve(__dirname, "..", "..", "..", "specflow", "public", "css", "report-print.css"), "utf8"),
      fs.promises.readFile(path.resolve(__dirname, "..", "..", "..", "specflow", "public", "js", "report-pagination.js"), "utf8")
    ]).then(([cssPreview, cssPrint, paginationJs]) => ({ cssPreview, cssPrint, paginationJs }))
      .catch((err) => {
        previewStaticAssetsPromise = null;
        throw err;
      });
  }
  return previewStaticAssetsPromise;
}

async function acquirePdfRenderSlot() {
  if (activePdfJobs < DEFAULT_PDF_CONCURRENCY) {
    activePdfJobs += 1;
    return;
  }
  await new Promise((resolve) => pdfQueue.push(resolve));
  activePdfJobs += 1;
}

function releasePdfRenderSlot() {
  activePdfJobs = Math.max(0, activePdfJobs - 1);
  const next = pdfQueue.shift();
  if (typeof next === "function") next();
}

async function withPdfRenderSlot(task) {
  await acquirePdfRenderSlot();
  try {
    return await task();
  } finally {
    releasePdfRenderSlot();
  }
}

async function getSharedBrowser(puppeteer) {
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = launchBrowser(puppeteer)
      .then((browser) => {
        browser.on("disconnected", () => {
          sharedBrowserPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        sharedBrowserPromise = null;
        throw err;
      });
  }
  return sharedBrowserPromise;
}

async function createPdfPage(puppeteer) {
  const browser = await getSharedBrowser(puppeteer);
  return browser.newPage();
}

async function withPdfPage(puppeteer, task) {
  return withPdfRenderSlot(async () => {
    const page = await createPdfPage(puppeteer);
    try {
      return await task(page);
    } finally {
      await page.close().catch(() => {});
    }
  });
}

async function buildPdfBufferFromHtml(html, fallbackPayload) {
  const puppeteer = getPuppeteerOrNull();
  if (!puppeteer) {
    return buildPdfBuffer(fallbackPayload || {});
  }
  const { cssPreview, cssPrint, paginationJs } = await loadPreviewStaticAssets();

  // Base URL fictícia — só usada internamente para que o Puppeteer resolva as URLs das imagens
  const appBaseUrl = String(env.appBaseUrl || "http://localhost:3000").replace(/\/+$/, "");

  // Pré-carrega imagens ANTES de abrir o browser (handler síncrono)
  const imageCache = await preloadImageCache(html, appBaseUrl);

  const fullHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=960, initial-scale=1.0" />
  <base href="${appBaseUrl}/" />
  <style>${cssPreview}</style>
  <style>${cssPrint}</style>
</head>
<body>
${html}
<script>${paginationJs}</script>
</body>
</html>`;

  return withPdfPage(puppeteer, async (page) => {

    // Handler síncrono — sem async, sem risco de timing
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const reqUrl = req.url();
      const cached = imageCache.get(reqUrl);
      if (cached) {
        req.respond({ status: 200, contentType: cached.mime, body: cached.body });
      } else {
        req.abort();
      }
    });

    await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
    await page.setContent(fullHtml, { waitUntil: "domcontentloaded" });

    // Aguarda todas as imagens carregarem (ou falharem) + fonts + paginação
    await page.evaluate(async () => {
      const images = Array.from(document.images || []);
      await Promise.all(images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        });
      }));
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    });
    await page.waitForFunction(() => window.__reportPaginationDone === true, { timeout: 10000 }).catch(() => {});

    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });
    return Buffer.from(buffer);
  });
}

async function buildPdfBufferFromUrl(url, options = {}) {
  const puppeteer = getPuppeteerOrNull();
  if (!puppeteer) {
    const err = new Error("Puppeteer não está instalado no ambiente.");
    err.code = "PUPPETEER_MISSING";
    throw err;
  }
  const targetUrl = String(url || "").trim();
  if (!targetUrl) {
    throw new Error("URL invalida para gerar PDF.");
  }

  const cookieHeader = String(options.cookieHeader || "").trim();

  return withPdfPage(puppeteer, async (page) => {
    await page.setViewport({
      width: 1240,
      height: 1754,
      deviceScaleFactor: 1
    });
    if (cookieHeader) {
      await page.setExtraHTTPHeaders({ Cookie: cookieHeader });
    }
    await page.goto(targetUrl, { waitUntil: "networkidle0" });
    await page.evaluate(async () => {
      const images = Array.from(document.images || []);
      await Promise.all(images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        });
      }));
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    });
    await page.waitForFunction(() => window.__reportPaginationDone === true, { timeout: 10000 }).catch(() => {});
    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });
    return Buffer.from(buffer);
  });
}

async function generatePdfToFile(payload, outputPath, htmlSource = "") {
  const buffer = htmlSource
    ? await buildPdfBufferFromHtml(htmlSource, payload)
    : await buildPdfBuffer(payload);
  await fs.promises.writeFile(outputPath, buffer);
  return outputPath;
}

async function buildAnalyticsPdfBufferFromHtml(html) {
  const puppeteer = getPuppeteerOrNull();
  if (!puppeteer) {
    throw new Error("Puppeteer não está instalado. Instale puppeteer para gerar o PDF do dashboard.");
  }
  return withPdfPage(puppeteer, async (page) => {
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    // Wait for Chart.js to finish rendering all canvases
    await page.waitForFunction(() => window.__analyticsPdfReady === true, { timeout: 15000 }).catch(() => {});
    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", right: "12mm", bottom: "14mm", left: "12mm" }
    });
    return Buffer.from(buffer);
  });
}

module.exports = {
  buildPdfBuffer,
  buildPdfBufferFromHtml,
  buildPdfBufferFromUrl,
  buildAnalyticsPdfBufferFromHtml,
  generatePdfToFile
};
