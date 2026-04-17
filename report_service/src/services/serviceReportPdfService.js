const fs = require("fs");
const PDFDocument = require("pdfkit");
const { formatServiceOrderDisplay } = require("../utils/serviceOrderDisplay");
const env = require("../../../specflow/config/env");

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

async function buildPdfBufferFromHtml(html, fallbackPayload) {
  const puppeteer = getPuppeteerOrNull();
  if (!puppeteer) {
    return buildPdfBuffer(fallbackPayload || {});
  }
  const path = require("path");
  const cssPreview = fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "specflow", "public", "css", "report-preview.css"), "utf8");
  const cssPrint = fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "specflow", "public", "css", "report-print.css"), "utf8");
  const paginationJs = fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "specflow", "public", "js", "report-pagination.js"), "utf8");
  const appBaseUrl = String(env.appBaseUrl || "http://localhost:3000").replace(/\/+$/, "") + "/";

  const fullHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=850, initial-scale=1.0" />
  <base href="${appBaseUrl}" />
  <style>${cssPreview}</style>
  <style>${cssPrint}</style>
</head>
<body>
${html}
<script>${paginationJs}</script>
</body>
</html>`;

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({
      width: 1240,
      height: 1754,
      deviceScaleFactor: 1
    });
    await page.setContent(fullHtml, { waitUntil: "networkidle0" });
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
  } finally {
    if (browser) await browser.close();
  }
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

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
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
  } finally {
    if (browser) await browser.close();
  }
}

async function generatePdfToFile(payload, outputPath, htmlSource = "") {
  const buffer = htmlSource
    ? await buildPdfBufferFromHtml(htmlSource, payload)
    : await buildPdfBuffer(payload);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

async function buildAnalyticsPdfBufferFromHtml(html) {
  const puppeteer = getPuppeteerOrNull();
  if (!puppeteer) {
    throw new Error("Puppeteer não está instalado. Instale puppeteer para gerar o PDF do dashboard.");
  }
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
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
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = {
  buildPdfBuffer,
  buildPdfBufferFromHtml,
  buildPdfBufferFromUrl,
  buildAnalyticsPdfBufferFromHtml,
  generatePdfToFile
};
