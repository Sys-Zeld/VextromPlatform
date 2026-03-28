const fs = require("fs");
const PDFDocument = require("pdfkit");
const { formatServiceOrderDisplay } = require("../utils/serviceOrderDisplay");

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

    drawSection(doc, "Escopo", "");
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
      drawSection(doc, section.section_title, normalizedText || section.content_text || "-");
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

function buildPdfBufferFromHtml(html, fallbackPayload) {
  const plain = htmlToPlainText(html);
  if (!plain) return buildPdfBuffer(fallbackPayload);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42, size: "A4" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font("Helvetica").fontSize(9.5).fillColor("#1f1f1f").text(plain, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      lineGap: 2
    });
    doc.end();
  });
}

async function generatePdfToFile(payload, outputPath, htmlSource = "") {
  const buffer = htmlSource
    ? await buildPdfBufferFromHtml(htmlSource, payload)
    : await buildPdfBuffer(payload);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

module.exports = {
  buildPdfBuffer,
  buildPdfBufferFromHtml,
  generatePdfToFile
};
