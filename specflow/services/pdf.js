const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const env = require("../config/env");
const { createTranslator } = require("../i18n");

const PDF_DEFAULT_PALETTES = {
  soft: {
    cardBackground: "#f4f7f5",
    borderColor: "#b9cec0",
    titleColor: "#12353f",
    headerColor: "#1e6738",
    textColor: "#0f2531",
    rowEvenBackground: "#dde4e0",
    rowOddBackground: "#f0f3f2",
    lineColor: "#b7c8bd",
    badgeBackground: "#d8e9db",
    badgeBorder: "#9dbca5",
    badgeText: "#1f5a2a"
  },
  vextrom: {
    cardBackground: "#eef5ef",
    borderColor: "#b0c8b3",
    titleColor: "#1d4626",
    headerColor: "#2d7b3b",
    textColor: "#10321a",
    rowEvenBackground: "#d5e4d7",
    rowOddBackground: "#e6efe8",
    lineColor: "#a7beaa",
    badgeBackground: "#d2e8d7",
    badgeBorder: "#8db898",
    badgeText: "#205e2f"
  },
  xvextrom: {
    cardBackground: "#f3f8f2",
    borderColor: "#b9d1b9",
    titleColor: "#1d4b2c",
    headerColor: "#2d7b3b",
    textColor: "#143526",
    rowEvenBackground: "#dce9db",
    rowOddBackground: "#edf4ec",
    lineColor: "#b0c7b1",
    badgeBackground: "#d9ecd9",
    badgeBorder: "#95bc9b",
    badgeText: "#205d2e"
  }
};

function resolvePdfPalette(theme, pdfTemplate) {
  const themeKey = String(theme || "").toLowerCase() === "xvextrom"
    ? "xvextrom"
    : (String(theme || "").toLowerCase() === "vextrom" ? "vextrom" : "soft");
  const fallback = PDF_DEFAULT_PALETTES[themeKey] || PDF_DEFAULT_PALETTES.soft;
  const source = pdfTemplate && pdfTemplate.palette && typeof pdfTemplate.palette === "object"
    ? pdfTemplate.palette
    : {};
  return {
    cardBackground: String(source.cardBackground || fallback.cardBackground),
    borderColor: String(source.borderColor || fallback.borderColor),
    titleColor: String(source.titleColor || fallback.titleColor),
    headerColor: String(source.headerColor || fallback.headerColor),
    textColor: String(source.textColor || fallback.textColor),
    rowEvenBackground: String(source.rowEvenBackground || fallback.rowEvenBackground),
    rowOddBackground: String(source.rowOddBackground || fallback.rowOddBackground),
    lineColor: String(source.lineColor || fallback.lineColor),
    badgeBackground: String(source.badgeBackground || fallback.badgeBackground),
    badgeBorder: String(source.badgeBorder || fallback.badgeBorder),
    badgeText: String(source.badgeText || fallback.badgeText)
  };
}

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

function normalizeUnitValue(field) {
  const raw = field && (field.unit || field.measureUnit || "");
  const value = String(raw || "").trim();
  return value || "-";
}

function formatBrazilDateTime(value) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "-");
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${parts.day || "00"}/${parts.month || "00"}/${parts.year || "0000"} ${parts.hour || "00"}:${parts.minute || "00"}:${parts.second || "00"}:${ms}`;
}

function sectionRowHeight(doc, widths, cells) {
  const paddingY = 7;
  const minHeight = 30;
  const heights = cells.map((cell, index) =>
    doc.heightOfString(String(cell || ""), {
      width: Math.max(10, widths[index] - 14)
    })
  );
  return Math.max(minHeight, Math.max(...heights) + paddingY * 2);
}

function drawSectionFieldValueWithBadge(doc, {
  x,
  y,
  width,
  text,
  isDefault,
  badgeText,
  palette
}) {
  const safeText = String(text || "-");
  const lineHeight = 11;
  const textWidth = Math.max(14, width - 8);
  doc.font("Helvetica").fontSize(10.5);
  doc
    .fillColor("#0f2531")
    .text(safeText, x, y, {
      width: textWidth,
      height: lineHeight + 6,
      ellipsis: true
    });

  if (!isDefault) return;

  const normalizedBadge = String(badgeText || "PADRAO").toUpperCase();
  const badgePaddingX = 8;
  const badgeHeight = 16;
  const measured = doc.widthOfString(safeText);
  doc.font("Helvetica-Bold").fontSize(8.4);
  const badgeTextWidth = doc.widthOfString(normalizedBadge);
  const badgeWidth = badgeTextWidth + badgePaddingX * 2;
  const startX = Math.min(x + Math.max(0, measured) + 8, x + width - badgeWidth - 4);
  const badgeY = y - 1;
  const colors = palette || PDF_DEFAULT_PALETTES.soft;

  doc.save();
  doc.roundedRect(startX, badgeY, badgeWidth, badgeHeight, 8).fillColor(colors.badgeBackground).fill();
  doc.roundedRect(startX, badgeY, badgeWidth, badgeHeight, 8).lineWidth(0.7).strokeColor(colors.badgeBorder).stroke();
  doc.restore();
  doc
    .font("Helvetica-Bold")
    .fontSize(8.4)
    .fillColor(colors.badgeText)
    .text(normalizedBadge, startX + badgePaddingX, badgeY + 4.2, {
      width: badgeTextWidth + 1,
      align: "center",
      lineBreak: false
    });
}

function drawSectionCardTable(doc, {
  x,
  width,
  title,
  headers,
  rows,
  defaultBadgeLabel,
  palette
}) {
  const colors = palette || PDF_DEFAULT_PALETTES.soft;
  const cardPaddingX = 12;
  const cardPaddingTop = 12;
  const cardPaddingBottom = 10;
  const titleHeight = 19;
  const headerHeight = 22;
  const rowGap = 0;
  const columnWidths = [width * 0.58, width * 0.22, width * 0.20];
  const rowsSafe = Array.isArray(rows) ? rows : [];
  const rowHeights = rowsSafe.map((row) =>
    sectionRowHeight(doc, columnWidths, [row.field, row.value, row.unit])
  );
  const rowsHeight = rowHeights.reduce((sum, rowHeight) => sum + rowHeight + rowGap, 0);
  const totalHeight =
    cardPaddingTop
    + titleHeight
    + headerHeight
    + rowsHeight
    + cardPaddingBottom;

  ensureSpace(doc, totalHeight + 8);

  const cardY = doc.y;
  doc.save();
  doc.roundedRect(x, cardY, width, totalHeight, 13).lineWidth(0.9).strokeColor(colors.borderColor).fillColor(colors.cardBackground).fillAndStroke();
  doc.restore();

  const innerX = x + cardPaddingX;
  const innerWidth = width - cardPaddingX * 2;

  doc
    .font("Helvetica-Bold")
    .fontSize(15)
    .fillColor(colors.titleColor)
    .text(String(title || "-"), innerX, cardY + 7, {
      width: innerWidth,
      lineBreak: false
    });

  const headerY = cardY + cardPaddingTop + titleHeight;
  const headerLabels = Array.isArray(headers) ? headers : ["CAMPO", "VALOR", "UNIDADE"];
  doc
    .font("Helvetica-Bold")
    .fontSize(10.2)
    .fillColor(colors.headerColor)
    .text(String(headerLabels[0] || "CAMPO").toUpperCase(), innerX + 4, headerY + 5, {
      width: columnWidths[0] - 8,
      lineBreak: false
    });
  doc
    .text(String(headerLabels[1] || "VALOR").toUpperCase(), innerX + columnWidths[0] + 4, headerY + 5, {
      width: columnWidths[1] - 8,
      lineBreak: false
    });
  doc
    .text(String(headerLabels[2] || "UNIDADE").toUpperCase(), innerX + columnWidths[0] + columnWidths[1] + 4, headerY + 5, {
      width: columnWidths[2] - 8,
      lineBreak: false
    });

  let currentY = headerY + headerHeight;
  rowsSafe.forEach((row, index) => {
    const rowHeight = rowHeights[index];
    const isEven = index % 2 === 0;
    doc.save();
    doc.fillColor(isEven ? colors.rowEvenBackground : colors.rowOddBackground).rect(innerX, currentY, innerWidth, rowHeight).fill();
    doc.restore();
    doc.save();
    doc.moveTo(innerX, currentY).lineTo(innerX + innerWidth, currentY).lineWidth(0.6).strokeColor(colors.lineColor).stroke();
    doc.restore();

    doc
      .font("Helvetica")
      .fontSize(10.8)
      .fillColor(colors.textColor)
      .text(String(row.field || "-"), innerX + 4, currentY + 8, {
        width: columnWidths[0] - 10,
        height: rowHeight - 10,
        ellipsis: true
      });

    drawSectionFieldValueWithBadge(doc, {
      x: innerX + columnWidths[0] + 4,
      y: currentY + 8,
      width: columnWidths[1] - 10,
      text: row.value,
      isDefault: Boolean(row.isDefault),
      badgeText: defaultBadgeLabel,
      palette: colors
    });

    doc
      .font("Helvetica")
      .fontSize(10.8)
      .fillColor(colors.textColor)
      .text(String(row.unit || "-"), innerX + columnWidths[0] + columnWidths[1] + 4, currentY + 8, {
        width: columnWidths[2] - 10,
        height: rowHeight - 10,
        ellipsis: true
      });

    currentY += rowHeight + rowGap;
  });

  doc.save();
  doc.moveTo(innerX, currentY).lineTo(innerX + innerWidth, currentY).lineWidth(0.6).strokeColor(colors.lineColor).stroke();
  doc.restore();

  doc.y = cardY + totalHeight + 10;
}

function estimateSectionCardTableHeight(doc, { width, rows }) {
  const cardPaddingTop = 12;
  const cardPaddingBottom = 10;
  const titleHeight = 19;
  const headerHeight = 22;
  const rowGap = 0;
  const columnWidths = [width * 0.58, width * 0.22, width * 0.20];
  const rowsSafe = Array.isArray(rows) ? rows : [];
  const rowHeights = rowsSafe.map((row) =>
    sectionRowHeight(doc, columnWidths, [row.field, row.value, row.unit])
  );
  const rowsHeight = rowHeights.reduce((sum, rowHeight) => sum + rowHeight + rowGap, 0);
  return cardPaddingTop + titleHeight + headerHeight + rowsHeight + cardPaddingBottom + 10;
}

function drawSummaryCard(doc, {
  x,
  width,
  title,
  qrBuffer,
  rows,
  palette
}) {
  const colors = palette || PDF_DEFAULT_PALETTES.soft;
  const safeRows = Array.isArray(rows) ? rows : [];
  const qrSize = 88;
  const cardPadding = 12;
  const lineHeight = 14;
  const extraLinkLines = safeRows.reduce((count, row) => count + (row && row.isLink ? 1 : 0), 0);
  const contentHeight = Math.max(qrSize, (safeRows.length + extraLinkLines) * lineHeight + 26);
  const totalHeight = cardPadding * 2 + contentHeight;
  ensureSpace(doc, totalHeight + 8);

  const y = doc.y;
  doc.save();
  doc.roundedRect(x, y, width, totalHeight, 13).lineWidth(0.9).strokeColor(colors.borderColor).fillColor(colors.cardBackground).fillAndStroke();
  doc.restore();

  const innerX = x + cardPadding;
  const innerY = y + cardPadding;
  const qrX = x + width - cardPadding - qrSize;
  const qrY = innerY + 2;
  const textWidth = width - cardPadding * 3 - qrSize;

  doc
    .font("Helvetica-Bold")
    .fontSize(15)
    .fillColor(colors.titleColor)
    .text(String(title || "-"), innerX, innerY, {
      width: textWidth,
      lineBreak: false
    });

  let lineY = innerY + 22;
  safeRows.forEach((row) => {
    const label = String((row && row.label) || "-");
    const value = String((row && row.value) || "-");
    if (row && row.isLink) {
      doc
        .font("Helvetica")
        .fontSize(10.2)
        .fillColor(colors.textColor)
        .text(`${label}:`, innerX, lineY, {
          width: textWidth
        });
      lineY += lineHeight;

      doc
        .font("Helvetica")
        .fontSize(9.8)
        .fillColor("#0b57d0")
        .text(value, innerX, lineY, {
          width: textWidth,
          link: value,
          underline: true
        });
    } else {
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(colors.textColor)
        .text(`${label}: ${value}`, innerX, lineY, {
          width: textWidth,
          ellipsis: true
        });
    }
    lineY += lineHeight;
  });

  if (qrBuffer) {
    doc.image(qrBuffer, qrX, qrY, { fit: [qrSize, qrSize] });
  }
  doc
    .font("Helvetica")
    .fontSize(8.2)
    .fillColor(colors.textColor)
    .text("QR", qrX, qrY + qrSize + 1, { width: qrSize, align: "center" });

  doc.y = y + totalHeight + 10;
}

function estimateSummaryCardHeight(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const qrSize = 88;
  const cardPadding = 12;
  const lineHeight = 14;
  const extraLinkLines = safeRows.reduce((count, row) => count + (row && row.isLink ? 1 : 0), 0);
  const contentHeight = Math.max(qrSize, (safeRows.length + extraLinkLines) * lineHeight + 26);
  const totalHeight = cardPadding * 2 + contentHeight;
  return totalHeight + 10;
}

function drawSimpleCardTable(doc, {
  x,
  width,
  title,
  headers,
  columnWidths,
  rows,
  palette
}) {
  const colors = palette || PDF_DEFAULT_PALETTES.soft;
  const rowsSafe = Array.isArray(rows) ? rows : [];
  const rawCols = Array.isArray(columnWidths) && columnWidths.length ? columnWidths : [width];
  const cardPaddingX = 12;
  const cardPaddingTop = 12;
  const cardPaddingBottom = 10;
  const titleHeight = 19;
  const headerHeight = 22;
  const innerWidth = width - cardPaddingX * 2;
  const rawTotal = rawCols.reduce((sum, value) => sum + Number(value || 0), 0) || innerWidth;
  const cols = rawCols.map((value) => (Number(value || 0) / rawTotal) * innerWidth);
  const rowHeights = rowsSafe.map((cells) =>
    sectionRowHeight(doc, cols, cells)
  );
  const rowsHeight = rowHeights.reduce((sum, current) => sum + current, 0);
  const totalHeight = cardPaddingTop + titleHeight + headerHeight + rowsHeight + cardPaddingBottom;
  ensureSpace(doc, totalHeight + 8);

  const y = doc.y;
  const innerX = x + cardPaddingX;
  doc.save();
  doc.roundedRect(x, y, width, totalHeight, 13).lineWidth(0.9).strokeColor(colors.borderColor).fillColor(colors.cardBackground).fillAndStroke();
  doc.restore();

  doc
    .font("Helvetica-Bold")
    .fontSize(15)
    .fillColor(colors.titleColor)
    .text(String(title || "-"), innerX, y + 7, {
      width: innerWidth,
      lineBreak: false
    });

  const headerY = y + cardPaddingTop + titleHeight;
  let accumX = innerX;
  headers.forEach((header, index) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(10.2)
      .fillColor(colors.headerColor)
      .text(String(header || "-").toUpperCase(), accumX + 4, headerY + 5, {
        width: cols[index] - 8,
        lineBreak: false
      });
    accumX += cols[index];
  });

  let rowY = headerY + headerHeight;
  rowsSafe.forEach((cells, rowIndex) => {
    const rowHeight = rowHeights[rowIndex];
    const isEven = rowIndex % 2 === 0;
    doc.save();
    doc.fillColor(isEven ? colors.rowEvenBackground : colors.rowOddBackground).rect(innerX, rowY, innerWidth, rowHeight).fill();
    doc.restore();
    doc.save();
    doc.moveTo(innerX, rowY).lineTo(innerX + innerWidth, rowY).lineWidth(0.6).strokeColor(colors.lineColor).stroke();
    doc.restore();

    let cellX = innerX;
    cells.forEach((cell, index) => {
      doc
        .font("Helvetica")
        .fontSize(10.8)
        .fillColor(colors.textColor)
        .text(String(cell || "-"), cellX + 4, rowY + 8, {
          width: cols[index] - 10,
          height: rowHeight - 10,
          ellipsis: true
        });
      cellX += cols[index];
    });
    rowY += rowHeight;
  });

  doc.save();
  doc.moveTo(innerX, rowY).lineTo(innerX + innerWidth, rowY).lineWidth(0.6).strokeColor(colors.lineColor).stroke();
  doc.restore();
  doc.y = y + totalHeight + 10;
}

function estimateSimpleCardTableHeight(doc, { width, columnWidths, rows }) {
  const rowsSafe = Array.isArray(rows) ? rows : [];
  const rawCols = Array.isArray(columnWidths) && columnWidths.length ? columnWidths : [width];
  const cardPaddingX = 12;
  const cardPaddingTop = 12;
  const cardPaddingBottom = 10;
  const titleHeight = 19;
  const headerHeight = 22;
  const innerWidth = width - cardPaddingX * 2;
  const rawTotal = rawCols.reduce((sum, value) => sum + Number(value || 0), 0) || innerWidth;
  const cols = rawCols.map((value) => (Number(value || 0) / rawTotal) * innerWidth);
  const rowHeights = rowsSafe.map((cells) =>
    sectionRowHeight(doc, cols, cells)
  );
  const rowsHeight = rowHeights.reduce((sum, current) => sum + current, 0);
  const totalHeight = cardPaddingTop + titleHeight + headerHeight + rowsHeight + cardPaddingBottom;
  return totalHeight + 10;
}

async function generatePdfBuffer({ submission, sections, documents = [], lang, theme = "soft", pdfTemplate = null }) {
  const t = createTranslator(lang);
  const palette = resolvePdfPalette(theme, pdfTemplate);
  const submissionLink = resolveSubmissionLink(submission, sections);
  const summaryLabels = lang === "en"
    ? {
      formProfile: "FORM PROFILE",
      token: "TOKEN",
      link: "ACCESS LINK",
      status: "STATUS",
      createdAt: "CREATED AT",
      updatedAt: "UPDATED AT",
      field: "FIELD",
      value: "VALUE",
      document: "DOCUMENT"
    }
    : {
      formProfile: "PERFIL DO FORMULARIO",
      token: "TOKEN",
      link: "LINK DE ACESSO",
      status: "STATUS",
      createdAt: "CRIADO EM",
      updatedAt: "ATUALIZADO EM",
      field: "CAMPO",
      value: "VALOR",
      document: "DOCUMENTO"
    };
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
    const createdAt = formatBrazilDateTime(submission.created_at || submission.createdAt);
    const updatedAt = formatBrazilDateTime(submission.updated_at || submission.updatedAt);
    const formProfile = submission.profileName || submission.profile_name || "-";
    const summaryRows = [
      { label: summaryLabels.formProfile, value: formProfile },
      { label: summaryLabels.token, value: submission.token || "-" },
      { label: summaryLabels.link, value: submissionLink, isLink: true },
      { label: summaryLabels.status, value: submission.status || "-" },
      { label: summaryLabels.createdAt, value: createdAt },
      { label: summaryLabels.updatedAt, value: updatedAt }
    ];
    const clientRows = [
      [t("admin.clientNameLabel"), submission.purchaser || "-"],
      [t("admin.clientContactLabel"), submission.purchaserContact || "-"],
      [t("admin.clientContactEmailLabel"), submission.contactEmail || "-"],
      [t("admin.clientContactPhoneLabel"), submission.contactPhone || "-"],
      [t("admin.projectNameLabel"), submission.projectName || "-"],
      [t("admin.siteNameLabel"), submission.siteName || "-"],
      [t("admin.addressLabel"), submission.address || "-"]
    ];
    const documentRows = (Array.isArray(documents) ? documents : [])
      .map((item) => [item.originalName || "-"]);
    const safeDocumentRows = documentRows.length ? documentRows : [[t("pdf.documentsEmpty")]];
    const sectionRowsBySection = sections.map((section) => ({
      title: section.section || section.title || "-",
      rows: (section.fields || []).map((field) => ({
        field: field.label || "-",
        value: resolveFieldDisplayValue(field),
        unit: normalizeUnitValue(field),
        isDefault: Boolean(field.cameFromDefault)
      }))
    }));

    const availableHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
    let estimatedTotalHeight = 0;
    estimatedTotalHeight += estimateSummaryCardHeight(summaryRows);
    estimatedTotalHeight += estimateSimpleCardTableHeight(doc, {
      width: contentWidth,
      columnWidths: [contentWidth * 0.35, contentWidth * 0.65],
      rows: clientRows
    });
    estimatedTotalHeight += estimateSimpleCardTableHeight(doc, {
      width: contentWidth,
      columnWidths: [contentWidth],
      rows: safeDocumentRows
    });
    sectionRowsBySection.forEach((sectionItem) => {
      estimatedTotalHeight += estimateSectionCardTableHeight(doc, {
        width: contentWidth,
        rows: sectionItem.rows
      });
    });

    if (estimatedTotalHeight < availableHeight) {
      doc.y = doc.page.margins.top + Math.max(0, (availableHeight - estimatedTotalHeight) / 2);
    }

    drawSummaryCard(doc, {
      x: startX,
      width: contentWidth,
      title: formProfile !== "-" ? formProfile : t("pdf.title"),
      qrBuffer,
      palette,
      rows: summaryRows
    });

    drawSimpleCardTable(doc, {
      x: startX,
      width: contentWidth,
      title: t("review.clientDataTitle"),
      headers: [summaryLabels.field, summaryLabels.value],
      columnWidths: [contentWidth * 0.35, contentWidth * 0.65],
      palette,
      rows: clientRows
    });
    drawSimpleCardTable(doc, {
      x: startX,
      width: contentWidth,
      title: t("pdf.documentsTitle"),
      headers: [summaryLabels.document],
      columnWidths: [contentWidth],
      palette,
      rows: safeDocumentRows
    });
    sectionRowsBySection.forEach((section) => {
      drawSectionCardTable(doc, {
        x: startX,
        width: contentWidth,
        title: section.title,
        headers: [t("review.tableField"), t("review.tableValue"), t("review.tableUnit")],
        rows: section.rows,
        palette,
        defaultBadgeLabel: t("field.defaultBadge")
      });
    });

    doc.end();
  });
}

module.exports = {
  generatePdfBuffer
};
