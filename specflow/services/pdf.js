const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const env = require("../config/env");
const { createTranslator } = require("../i18n");

function drawRow(doc, { x, y, widths, cells, rowHeight, options = {} }) {
  const paddingX = 6;
  const paddingY = 5;
  const borderColor = options.borderColor || "#9a9a9a";
  const fillColor = options.fillColor || null;
  const textColor = options.textColor || "#111111";
  const bold = Boolean(options.bold);
  const header = Boolean(options.header);
  let currentX = x;

  for (let i = 0; i < widths.length; i += 1) {
    const width = widths[i];
    if (fillColor) {
      doc.save();
      doc.fillColor(fillColor).rect(currentX, y, width, rowHeight).fill();
      doc.restore();
    }
    doc.save();
    doc.lineWidth(0.8).strokeColor(borderColor).rect(currentX, y, width, rowHeight).stroke();
    doc.restore();

    const filterBoxSize = 13;
    const filterGap = 3;
    const hasFilter = header;
    const rightReserve = hasFilter ? filterBoxSize + filterGap + 2 : 0;

    doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9.5)
      .fillColor(textColor)
      .text(String(cells[i] || ""), currentX + paddingX, y + paddingY, {
        width: width - paddingX * 2 - rightReserve,
        height: rowHeight - paddingY * 2
      });

    if (hasFilter) {
      const boxX = currentX + width - paddingX - filterBoxSize;
      const boxY = y + (rowHeight - filterBoxSize) / 2;
      doc.save();
      doc.fillColor("#e6e6e6").rect(boxX, boxY, filterBoxSize, filterBoxSize).fill();
      doc.lineWidth(0.6).strokeColor("#9a9a9a").rect(boxX, boxY, filterBoxSize, filterBoxSize).stroke();
      doc
        .fillColor("#4f4f4f")
        .moveTo(boxX + 3.5, boxY + 5)
        .lineTo(boxX + filterBoxSize - 3.5, boxY + 5)
        .lineTo(boxX + filterBoxSize / 2, boxY + filterBoxSize - 4)
        .closePath()
        .fill();
      doc.restore();
    }

    currentX += width;
  }
}

function rowHeightForCells(doc, widths, cells) {
  const paddingY = 5;
  const minHeight = 22;
  const heights = cells.map((cell, index) =>
    doc.heightOfString(String(cell || ""), {
      width: widths[index] - 12
    })
  );
  return Math.max(minHeight, Math.max(...heights) + paddingY * 2);
}

function ensureSpace(doc, requiredHeight) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + requiredHeight > bottomLimit) {
    doc.addPage();
  }
}

function drawSectionTitle(doc, { x, width, text }) {
  const sectionHeaderHeight = 20;
  doc.save();
  doc.fillColor("#d9d9d9").rect(x, doc.y, width, sectionHeaderHeight).fill();
  doc.restore();
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#2c2c2c")
    .text(text, x + 8, doc.y + 7, {
      width: width - 16,
      height: sectionHeaderHeight - 8
    });
  doc.y += sectionHeaderHeight;
}

function drawTableHeader(doc, { x, widths, labels }) {
  const tableHeaderHeight = 22;
  drawRow(doc, {
    x,
    y: doc.y,
    widths,
    cells: labels.map((label) => String(label || "").toUpperCase()),
    rowHeight: tableHeaderHeight,
    options: {
      header: true,
      bold: true,
      fillColor: "#000000",
      textColor: "#ffffff",
      borderColor: "#ffffff"
    }
  });
  doc.y += tableHeaderHeight;
}

function resolveSubmissionLink(submission, sections) {
  const cleanBaseUrl = String(env.appBaseUrl || "http://localhost:3000").replace(/\/+$/, "");
  return `${cleanBaseUrl}/form/${submission.token}/specification`;
}

function resolveFieldDisplayValue(field) {
  if (field.displayValue !== undefined && field.displayValue !== null && field.displayValue !== "") return field.displayValue;
  if (field.effectiveValue !== undefined && field.effectiveValue !== null && field.effectiveValue !== "") return field.effectiveValue;
  return "-";
}

async function generatePdfBuffer({ submission, sections, documents = [], lang }) {
  const t = createTranslator(lang);
  const tableLabels =
    lang === "en" ? ["CHARACTERISTIC", "UNIT", "DEFAULT"] : ["CARACTERISTICA", "UNIDADE", "DEFAULT"];
  const clientTableLabels = lang === "en" ? ["FIELD", "VALUE"] : ["CAMPO", "VALOR"];
  const docsTableLabels = lang === "en" ? ["DOCUMENT"] : ["DOCUMENTO"];
  const submissionLink = resolveSubmissionLink(submission, sections);
  const qrBuffer = await QRCode.toBuffer(submissionLink, {
    width: 220,
    margin: 1,
    color: {
      dark: "#000000",
      light: "#ffffff"
    }
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42, size: "A4" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const startX = doc.page.margins.left;
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidths = [contentWidth * 0.54, contentWidth * 0.20, contentWidth * 0.26];
    const qrSize = 78;
    const qrX = startX + contentWidth - qrSize;
    const qrY = doc.y;
    const textWidth = contentWidth - qrSize - 10;

    doc.image(qrBuffer, qrX, qrY, { fit: [qrSize, qrSize] });
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#333333")
      .text(t("pdf.qrHint"), qrX, qrY + qrSize + 2, { width: qrSize, align: "center" });

    doc.font("Helvetica-Bold").fontSize(16).fillColor("#000000").text(t("pdf.title"), startX, doc.y, {
      underline: true,
      width: textWidth
    });
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(10.5).fillColor("#000000").text(t("pdf.submissionToken", { token: submission.token }), {
      width: textWidth
    });
    doc.fillColor("#0b57d0").text(t("pdf.accessLink", { link: submissionLink }), {
      width: textWidth,
      link: submissionLink,
      underline: true
    });
    const createdAt = submission.created_at || submission.createdAt || "-";
    const updatedAt = submission.updated_at || submission.updatedAt || "-";
    doc.fillColor("#000000").text(t("pdf.status", { status: submission.status || "-" }), { width: textWidth });
    doc.text(t("pdf.createdAt", { value: createdAt }), { width: textWidth });
    doc.text(t("pdf.updatedAt", { value: updatedAt }), { width: textWidth });

    const minHeaderBottom = qrY + qrSize + 18;
    if (doc.y < minHeaderBottom) {
      doc.y = minHeaderBottom;
    }
    doc.moveDown(0.5);

    const clientRows = [
      [t("admin.clientNameLabel"), submission.purchaser || "-"],
      [t("admin.clientContactLabel"), submission.purchaserContact || "-"],
      [t("admin.clientContactEmailLabel"), submission.contactEmail || "-"],
      [t("admin.clientContactPhoneLabel"), submission.contactPhone || "-"],
      [t("admin.projectNameLabel"), submission.projectName || "-"],
      [t("admin.siteNameLabel"), submission.siteName || "-"],
      [t("admin.addressLabel"), submission.address || "-"]
    ];
    const clientColWidths = [contentWidth * 0.35, contentWidth * 0.65];
    ensureSpace(doc, 20 + 22 + 8);
    drawSectionTitle(doc, { x: startX, width: contentWidth, text: t("review.clientDataTitle") });
    drawTableHeader(doc, { x: startX, widths: clientColWidths, labels: clientTableLabels });
    clientRows.forEach((cells) => {
      const rowHeight = rowHeightForCells(doc, clientColWidths, cells);
      if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        drawSectionTitle(doc, { x: startX, width: contentWidth, text: t("review.clientDataTitle") });
        drawTableHeader(doc, { x: startX, widths: clientColWidths, labels: clientTableLabels });
      }
      drawRow(doc, {
        x: startX,
        y: doc.y,
        widths: clientColWidths,
        cells,
        rowHeight,
        options: {
          fillColor: "#cfcfcf",
          borderColor: "#ffffff"
        }
      });
      doc.y += rowHeight;
    });
    doc.moveDown(0.6);

    const documentRows = (Array.isArray(documents) ? documents : [])
      .map((item) => [item.originalName || "-"]);
    const docsColWidths = [contentWidth];
    ensureSpace(doc, 20 + 22 + 8);
    drawSectionTitle(doc, { x: startX, width: contentWidth, text: t("pdf.documentsTitle") });
    drawTableHeader(doc, { x: startX, widths: docsColWidths, labels: docsTableLabels });
    if (!documentRows.length) {
      const emptyRow = [t("pdf.documentsEmpty")];
      const rowHeight = rowHeightForCells(doc, docsColWidths, emptyRow);
      drawRow(doc, {
        x: startX,
        y: doc.y,
        widths: docsColWidths,
        cells: emptyRow,
        rowHeight,
        options: {
          fillColor: "#cfcfcf",
          borderColor: "#ffffff"
        }
      });
      doc.y += rowHeight;
    } else {
      documentRows.forEach((cells) => {
        const rowHeight = rowHeightForCells(doc, docsColWidths, cells);
        if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          drawSectionTitle(doc, { x: startX, width: contentWidth, text: t("pdf.documentsTitle") });
          drawTableHeader(doc, { x: startX, widths: docsColWidths, labels: docsTableLabels });
        }
        drawRow(doc, {
          x: startX,
          y: doc.y,
          widths: docsColWidths,
          cells,
          rowHeight,
          options: {
            fillColor: "#cfcfcf",
            borderColor: "#ffffff"
          }
        });
        doc.y += rowHeight;
      });
    }
    doc.moveDown(0.6);

    sections.forEach((section) => {
      const sectionHeaderHeight = 20;
      const tableHeaderHeight = 22;
      ensureSpace(doc, sectionHeaderHeight + tableHeaderHeight + 8);
      drawSectionTitle(doc, { x: startX, width: contentWidth, text: section.section || section.title });
      drawTableHeader(doc, { x: startX, widths: colWidths, labels: tableLabels });

      (section.fields || []).forEach((field) => {
        const value = resolveFieldDisplayValue(field);
        const unit = field.unit || "-";
        const cells = [field.label, unit, value];
        const rowHeight = rowHeightForCells(doc, colWidths, cells);

        if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          drawSectionTitle(doc, { x: startX, width: contentWidth, text: section.section || section.title });
          drawTableHeader(doc, { x: startX, widths: colWidths, labels: tableLabels });
        }

        drawRow(doc, {
          x: startX,
          y: doc.y,
          widths: colWidths,
          cells,
          rowHeight,
          options: {
            fillColor: "#cfcfcf",
            borderColor: "#ffffff"
          }
        });
        doc.y += rowHeight;
      });
      doc.moveDown(0.6);
    });

    doc.end();
  });
}

module.exports = {
  generatePdfBuffer
};
