const path = require("path");
const { SECTION_DEFINITIONS } = require("../constants");
const sanitizeHtml = require("sanitize-html");
const { withServiceOrderDisplay } = require("../utils/serviceOrderDisplay");

const REPORT_UI_LABELS = {
  pt: {
    metadata: "METADADOS",
    preparedBy: "Executado por",
    revision: "Revisao",
    lastRevision: "Ultima revisao",
    os: "OS",
    updatedAt: "Atualizado em",
    toc: "SUMARIO",
    tocEmpty: "Sem capitulos.",
    signatures: "ASSINATURAS",
    signatureAlt: "Assinatura",
    continuation: "(continuacao...)",
    chapter: "CAPITULO",
    image: "Imagem",
    customer: "Cliente",
    site: "Site",
    reportLabel: "Relatorio",
    rev: "Rev.",
    logoPlaceholder: "Espaco para logo",
    dateLocale: "pt-BR"
  },
  en: {
    metadata: "METADATA",
    preparedBy: "Prepared by",
    revision: "Revision",
    lastRevision: "Last revision",
    os: "Work Order",
    updatedAt: "Updated at",
    toc: "TABLE OF CONTENTS",
    tocEmpty: "No chapters.",
    signatures: "SIGNATURES",
    signatureAlt: "Signature",
    continuation: "(continued...)",
    chapter: "CHAPTER",
    image: "Image",
    customer: "Client",
    site: "Site",
    reportLabel: "Report",
    rev: "Rev.",
    logoPlaceholder: "Logo space",
    dateLocale: "en-US"
  },
  es: {
    metadata: "METADATOS",
    preparedBy: "Ejecutado por",
    revision: "Revision",
    lastRevision: "Ultima revision",
    os: "Orden de Servicio",
    updatedAt: "Actualizado en",
    toc: "SUMARIO",
    tocEmpty: "Sin capitulos.",
    signatures: "FIRMAS",
    signatureAlt: "Firma",
    continuation: "(continuacion...)",
    chapter: "CAPITULO",
    image: "Imagen",
    customer: "Cliente",
    site: "Site",
    reportLabel: "Informe",
    rev: "Rev.",
    logoPlaceholder: "Espacio para logo",
    dateLocale: "es-ES"
  },
  fr: {
    metadata: "METADONNEES",
    preparedBy: "Execute par",
    revision: "Revision",
    lastRevision: "Derniere revision",
    os: "Ordre de service",
    updatedAt: "Mis a jour le",
    toc: "SOMMAIRE",
    tocEmpty: "Pas de chapitres.",
    signatures: "SIGNATURES",
    signatureAlt: "Signature",
    continuation: "(suite...)",
    chapter: "CHAPITRE",
    image: "Image",
    customer: "Client",
    site: "Site",
    reportLabel: "Rapport",
    rev: "Rev.",
    logoPlaceholder: "Espace logo",
    dateLocale: "fr-FR"
  }
};

function getSectionContent(sections, key) {
  const section = (sections || []).find((item) => item.section_key === key);
  const isVisible = section?.is_visible !== false;
  return {
    title: section?.section_title || SECTION_DEFINITIONS.find((item) => item.key === key)?.title || key,
    html: isVisible ? section?.content_html || "" : "",
    text: isVisible ? section?.content_text || "" : "",
    isVisible
  };
}

function groupComponents(items) {
  const groups = {
    replaced: [],
    required: [],
    spare_recommended: []
  };
  (items || []).forEach((item) => {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
  });
  return groups;
}

function normalizeTocTitle(section) {
  const fallback = SECTION_DEFINITIONS.find((d) => d.key === section?.section_key)?.title || section?.section_key || "-";
  const titleHtml = String(section?.section_title_html || "").trim();
  if (titleHtml) {
    const withLineBreaks = titleHtml
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
      .replace(/<\/div>\s*<div[^>]*>/gi, "\n");
    const plain = sanitizeHtml(withLineBreaks, { allowedTags: [], allowedAttributes: {} });
    const firstLine = plain
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (firstLine) return firstLine;
  }

  const raw = section?.section_title_text || section?.section_title || fallback;
  const normalized = String(raw || fallback).replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toImagePublicSrc(filePath) {
  const raw = String(filePath || "").trim();
  if (!raw) return "";
  if (/^data:image\//i.test(raw)) return raw;
  const normalized = raw.replace(/\\/g, "/");
  if (/^https?:\/\//i.test(normalized)) return normalized;
  const fileName = path.posix.basename(normalized);
  if (!fileName || fileName === "." || fileName === "/") return "";
  return `/docs/report/img/${encodeURIComponent(fileName)}`;
}

function renderInlineImageCard(image, requestedId = null, imageLabel = "Imagem") {
  const fallbackCaption = requestedId ? `${imageLabel} ${requestedId}` : imageLabel;
  const caption = escapeHtml((image && image.caption) || fallbackCaption);
  const publicSrc = toImagePublicSrc(image && image.filePath);
  if (!publicSrc) {
    return `<figure class="report-inline-image-card"><div class="report-inline-image-missing">${escapeHtml(`ID ${requestedId || "-"}`)}</div><figcaption class="report-inline-image-caption">${caption}</figcaption></figure>`;
  }
  const safePath = escapeHtml(publicSrc);
  return `<figure class="report-inline-image-card"><img class="report-inline-image" src="${safePath}" alt="${caption}" width="250" height="250" style="object-fit:cover;width:250px;height:250px;display:block;" /><figcaption class="report-inline-image-caption">${caption}</figcaption></figure>`;
}

function formatComponentQuantity(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0) return String(Math.trunc(number)).padStart(2, "0");
  const raw = String(value || "").trim();
  return raw || "-";
}

function formatComponentDescription(value) {
  const source = String(value || "").trim();
  if (!source) return "-";
  const pattern = /\(\s*SPARE\s+A\s+BORDO\s*\)/gi;
  let lastIndex = 0;
  let output = "";
  let match;
  while ((match = pattern.exec(source)) !== null) {
    output += escapeHtml(source.slice(lastIndex, match.index));
    output += `<span class="report-inline-components-spare">${escapeHtml(match[0])}</span>`;
    lastIndex = match.index + match[0].length;
  }
  output += escapeHtml(source.slice(lastIndex));
  return output;
}

function getComponentRowsByCategory(componentItems, categoryKey) {
  const rows = Array.isArray(componentItems) ? componentItems : [];
  const normalized = String(categoryKey || "").trim().toLowerCase();
  if (!normalized) return rows;
  return rows.filter((item) => {
    const category = String(item?.category || "").trim().toLowerCase();
    if (normalized === "replaced") return category === "replaced";
    if (normalized === "required") return category === "required";
    if (normalized === "spare") return category === "spare_recommended" || category === "spare";
    return false;
  });
}

function renderComponentsInlineTable(componentItems) {
  const rows = Array.isArray(componentItems) ? componentItems : [];
  const first = rows[0] || {};
  const equipmentName = escapeHtml(first.equipment_type || first.equipment_model_family || "COMPONENTES");
  const powerLabel = escapeHtml(first.equipment_power || "-");
  const serialLabel = escapeHtml(first.equipment_serial || "-");
  const tagLabel = escapeHtml(first.equipment_tag || "-");
  const rbLabel = escapeHtml(first.equipment_dt || "-");

  const bodyRows = rows.length
    ? rows.map((item) => `
      <tr>
        <td class="report-inline-components-qty">${escapeHtml(formatComponentQuantity(item.quantity))}</td>
        <td class="report-inline-components-desc">${formatComponentDescription(item.description)}</td>
        <td class="report-inline-components-part">${escapeHtml(item.part_number || "-")}</td>
      </tr>
    `).join("")
    : `
      <tr>
        <td class="report-inline-components-empty" colspan="3">Sem componentes cadastrados.</td>
      </tr>
    `;

  return `
    <div class="report-inline-components-wrap">
      <table class="report-inline-components-table">
        <thead>
          <tr class="report-inline-components-meta">
            <th>${equipmentName}</th>
            <th>Power: ${powerLabel}</th>
            <th>Serie: ${serialLabel}</th>
          </tr>
          <tr class="report-inline-components-meta">
            <th>TAG: ${tagLabel}</th>
            <th colspan="2">RB: ${rbLabel}</th>
          </tr>
          <tr>
            <th>Quantity</th>
            <th>Description</th>
            <th>Part Number</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

function formatTimesheetDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "NA";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})[tT ]/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = String(date.getFullYear());
    return `${day}/${month}/${year}`;
  }
  return raw;
}

function normalizeTimesheetValue(value) {
  const raw = String(value || "").trim();
  return raw ? raw.toUpperCase() : "NA";
}

function renderTimesheetInlineTable(timesheetItems) {
  const rows = Array.isArray(timesheetItems) ? timesheetItems : [];
  const bodyRows = rows.length
    ? rows.map((item) => `
      <tr>
        <td>${escapeHtml(formatTimesheetDate(item.activity_date || item.activityDate))}</td>
        <td>${escapeHtml(normalizeTimesheetValue(item.check_in_base || item.checkInBase))}</td>
        <td>${escapeHtml(normalizeTimesheetValue(item.check_in_client || item.checkInClient))}</td>
        <td>${escapeHtml(normalizeTimesheetValue(item.check_out_client || item.checkOutClient))}</td>
        <td>${escapeHtml(normalizeTimesheetValue(item.check_out_base || item.checkOutBase))}</td>
      </tr>
    `).join("")
    : `
      <tr>
        <td colspan="5" class="report-inline-timesheet-empty">Sem registros de timesheet.</td>
      </tr>
    `;

  return `
    <div class="report-inline-timesheet-wrap">
      <table class="report-inline-timesheet-table">
        <thead>
          <tr class="report-inline-timesheet-title-row">
            <th colspan="5">TIME SHEET</th>
          </tr>
          <tr>
            <th>Data</th>
            <th>Check in base</th>
            <th>Check in client</th>
            <th>Check out client</th>
            <th>Check out base</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

function renderTechTeamInlineTable(technicianItems) {
  const rows = Array.isArray(technicianItems) ? technicianItems : [];
  const bodyRows = rows.length
    ? rows.map((item) => `
      <tr>
        <td>${escapeHtml(item.name || "-")}</td>
        <td>${escapeHtml(item.role || "-")}</td>
        <td>${escapeHtml(item.company || "-")}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="3" class="report-inline-techteam-empty">Sem tecnicos cadastrados.</td></tr>`;

  return `
    <div class="report-inline-techteam-wrap">
      <table class="report-inline-techteam-table">
        <thead>
          <tr class="report-inline-techteam-title-row">
            <th colspan="3">EQUIPE TECNICA</th>
          </tr>
          <tr>
            <th>Nome</th>
            <th>Funcao</th>
            <th>Empresa</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

function normalizeInlineCellValue(value, fallback = "-") {
  const raw = String(value == null ? "" : value).trim();
  return raw || fallback;
}

function renderEquipmentsInlineTable(orderEquipments) {
  const rows = (Array.isArray(orderEquipments) ? orderEquipments : [])
    .slice()
    .sort((a, b) => Number(a?.ref_id || 0) - Number(b?.ref_id || 0) || Number(a?.id || 0) - Number(b?.id || 0));

  if (!rows.length) {
    return `
      <div class="report-inline-equipments-wrap">
        <table class="report-inline-equipments-table">
          <tbody>
            <tr><td class="report-inline-equipments-empty">Sem equipamentos vinculados na OS.</td></tr>
          </tbody>
        </table>
      </div>
    `;
  }

  const pairsPerRow = 3;
  const columnsPerRow = pairsPerRow * 2;

  const renderPairsRows = (pairs) => {
    const chunks = [];
    for (let i = 0; i < pairs.length; i += pairsPerRow) {
      chunks.push(pairs.slice(i, i + pairsPerRow));
    }
    return chunks.map((chunk) => {
      const cells = chunk.map((pair) => `
        <th class="report-inline-equipments-label">${escapeHtml(pair.label)}</th>
        <td class="report-inline-equipments-value">${escapeHtml(normalizeInlineCellValue(pair.value))}</td>
      `).join("");
      const missingPairs = Math.max(0, pairsPerRow - chunk.length);
      const filler = missingPairs ? `<td colspan="${missingPairs * 2}" class="report-inline-equipments-filler"></td>` : "";
      return `<tr>${cells}${filler}</tr>`;
    }).join("");
  };

  const tablesHtml = rows.map((item) => {
    const tagValue = normalizeInlineCellValue(item.tag_number);
    const tableTitle = tagValue !== "-"
      ? `TAG ${tagValue}`
      : `Equipamento ${normalizeInlineCellValue(item.ref_id)}`;

    const pairs = [
      { label: "Tipo", value: item.type },
      { label: "Fabricante", value: item.manufacturer },
      { label: "Modelo/Família", value: item.model_family },
      { label: "Série", value: item.serial_number },
      { label: "DT", value: item.dt_number },
      { label: "Ano", value: item.year_of_manufacture },
      { label: "AC In (V)", value: item.rated_ac_input_voltage },
      { label: "In Freq", value: item.input_frequency },
      { label: "DC (V)", value: item.rated_dc_voltage },
      { label: "AC Out (V)", value: item.rated_ac_output_voltage },
      { label: "Out Freq", value: item.output_frequency },
      { label: "Grau Prot.", value: item.degree_of_protection },
      { label: "Main Label", value: item.main_label }
    ];

    return `
      <table class="report-inline-equipments-table">
        <thead>
          <tr class="report-inline-equipments-title-row">
            <th colspan="${columnsPerRow}">${escapeHtml(tableTitle)}</th>
          </tr>
        </thead>
        <tbody>${renderPairsRows(pairs)}</tbody>
      </table>
    `;
  }).join("");

  return `<div class="report-inline-equipments-wrap">${tablesHtml}</div>`;
}

function renderEquipmentTagsInline(orderEquipments) {
  const rows = Array.isArray(orderEquipments) ? orderEquipments : [];
  if (!rows.length) return "-";

  const seen = new Set();
  const tags = [];
  rows.forEach((item) => {
    const label = String(item?.tag_number || item?.tag || "").trim();
    if (!label) return;
    const dedupeKey = label.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    tags.push(label);
  });

  if (!tags.length) return "-";
  return escapeHtml(tags.join(", "));
}

function renderSiteInline(siteData) {
  const source = siteData && typeof siteData === "object" ? siteData : {};
  const siteLabel = String(source.site_name || source.name || source.title || "").trim();
  return siteLabel ? escapeHtml(siteLabel) : "-";
}

function renderDailyLogInlineItem(dailyLog, requestedId = null, context = null) {
  if (!dailyLog) return "";
  const contentHtml = String(dailyLog.content || "").trim();
  if (!contentHtml) return "";
  if (!context) return contentHtml;
  return injectTaggedImagesInHtml(
    contentHtml,
    context.imageById,
    context.componentItems,
    context.equipmentById,
    context.timesheetItems,
    context.dailyLogsById,
    context.dailyLogsOrdered,
    { expandDailyLogTags: false, imageLabel: context.imageLabel },
    context.technicianItems || [],
    context.orderEquipments || [],
    context.siteData || {}
  );
}

function renderAllDailyLogsInlineItems(dailyLogs, context = null) {
  const rows = Array.isArray(dailyLogs) ? dailyLogs : [];
  const rendered = rows
    .map((item) => renderDailyLogInlineItem(item, item && item.id, context))
    .filter((chunk) => String(chunk || "").trim().length > 0);
  return rendered.join("\n");
}

function wrapImageCardsIntoRows(html) {
  const figureRegex = /<figure class="report-inline-image-card">[\s\S]*?<\/figure>/gi;
  const tokenRegex = /<figure class="report-inline-image-card">[\s\S]*?<\/figure>|<br\s*\/?>/gi;

  function isSpacer(content) {
    const residue = String(content || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/\s+/g, "")
      .trim();
    return residue.length === 0;
  }

  function buildRowsFromTokens(tokens) {
    const lines = [[]];
    tokens.forEach((token) => {
      if (/^<br/i.test(String(token || ""))) {
        if (lines[lines.length - 1].length > 0) lines.push([]);
      } else {
        lines[lines.length - 1].push(token);
      }
    });
    const normalizedLines = lines.filter((line) => line.length > 0);
    if (!normalizedLines.length) return "";

    const rows = [];
    normalizedLines.forEach((lineFigures) => {
      for (let index = 0; index < lineFigures.length; index += 2) {
        rows.push(`<div class="report-inline-image-row">${lineFigures.slice(index, index + 2).join("")}</div>`);
      }
    });
    return rows.join("");
  }

  const source = String(html || "");
  if (!figureRegex.test(source)) return source;
  figureRegex.lastIndex = 0;

  const matches = [];
  let match;
  while ((match = tokenRegex.exec(source)) !== null) {
    matches.push({
      token: String(match[0] || ""),
      index: match.index,
      end: match.index + String(match[0] || "").length
    });
  }
  if (!matches.length) return source;

  let result = "";
  let cursor = 0;
  let i = 0;
  while (i < matches.length) {
    const current = matches[i];
    const leading = source.slice(cursor, current.index);
    result += leading;

    if (!/^<figure/i.test(current.token)) {
      result += current.token;
      cursor = current.end;
      i += 1;
      continue;
    }

    const runTokens = [current.token];
    let runEnd = current.end;
    let j = i + 1;
    while (j < matches.length) {
      const between = source.slice(runEnd, matches[j].index);
      if (!isSpacer(between)) break;
      runTokens.push(matches[j].token);
      runEnd = matches[j].end;
      j += 1;
    }

    result += buildRowsFromTokens(runTokens);
    cursor = runEnd;
    i = j;
  }

  if (cursor < source.length) result += source.slice(cursor);
  return result;
}

function injectTaggedImagesInHtml(contentHtml, imageById, componentItems, equipmentById, timesheetItems, dailyLogsById, dailyLogsOrdered, options = {}, technicianItems = [], orderEquipments = [], siteData = {}) {
  const source = String(contentHtml || "");
  if (!source) return "<p><br></p>";
  const opts = {
    expandDailyLogTags: options.expandDailyLogTags !== false
  };
  const equipmentTagPattern = /(?:@|&#64;)(?:\s|&nbsp;|<[^>]+>)*equip(?:\s|&nbsp;|<[^>]+>)*(?:=|&#61;)(?:\s|&nbsp;|<[^>]+>)*(\d+)/gi;
  const withEquipments = source.replace(equipmentTagPattern, (_match, rawId) => {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return _match;
    const equipment = equipmentById.get(id);
    const label = String(equipment?.tag || equipment?.type || "").trim();
    return label ? escapeHtml(label) : _match;
  });
  const imageTagPattern = /(?:@|&#64;)(?:\s|&nbsp;|<[^>]+>)*img(?:\s|&nbsp;|<[^>]+>)*(?:=|&#61;)(?:\s|&nbsp;|<[^>]+>)*(\d+)(?:\s|&nbsp;|<[^>]+>)*(?:imagem)?/gi;
  const withImages = withEquipments.replace(imageTagPattern, (_match, rawId) => {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return _match;
    const image = imageById.get(id);
    return renderInlineImageCard(image, id, opts.imageLabel || "Imagem");
  });
  const tableReplacedPattern = /(?:@|&#64;)(?:\s|&nbsp;|<[^>]+>)*tblcmpr/gi;
  const tableRequiredPattern = /(?:@|&#64;)(?:\s|&nbsp;|<[^>]+>)*tblcmpq/gi;
  const tableSparePattern = /(?:@|&#64;)(?:\s|&nbsp;|<[^>]+>)*tblcmps/gi;
  const withReplacedTable = withImages.replace(tableReplacedPattern, () => renderComponentsInlineTable(getComponentRowsByCategory(componentItems, "replaced")));
  const withRequiredTable = withReplacedTable.replace(tableRequiredPattern, () => renderComponentsInlineTable(getComponentRowsByCategory(componentItems, "required")));
  const withTables = withRequiredTable.replace(tableSparePattern, () => renderComponentsInlineTable(getComponentRowsByCategory(componentItems, "spare")));
  const equipmentTagsPattern = /(?:@|&#64;)(?:\s|&nbsp;|<[^>]+>)*(?:tagsequip|tagequip(?:amentos)?)/gi;
  const withEquipmentTags = withTables.replace(equipmentTagsPattern, () => renderEquipmentTagsInline(orderEquipments));
  const siteTagPattern = /(?:@|&#64;)(?:\s|&nbsp;|<[^>]+>)*(?:site|nomesite)/gi;
  const withSite = withEquipmentTags.replace(siteTagPattern, () => renderSiteInline(siteData));
  const equipmentTablePattern = /(?:@|&#64;)(?:\s|&nbsp;|<[^>]+>)*(?:tblequip(?:amentos)?)/gi;
  const withEquipmentTable = withSite.replace(equipmentTablePattern, () => renderEquipmentsInlineTable(orderEquipments));
  const timesheetTagPattern = /(?:@|&#64;)(?:\s|&nbsp;|<[^>]+>)*timesheet/gi;
  const withTimesheet = withEquipmentTable.replace(timesheetTagPattern, () => renderTimesheetInlineTable(timesheetItems));
  const techTeamTagPattern = /(?:@|&#64;)(?:\s|&nbsp;|<[^>]+>)*equipetecnica/gi;
  const withTechTeam = withTimesheet.replace(techTeamTagPattern, () => renderTechTeamInlineTable(technicianItems));
  if (!opts.expandDailyLogTags) return withTechTeam;

  const nestedContext = {
    imageById,
    componentItems,
    equipmentById,
    timesheetItems,
    dailyLogsById,
    dailyLogsOrdered,
    technicianItems,
    orderEquipments,
    siteData,
    imageLabel: opts.imageLabel || "Imagem"
  };
  const dailyLogTagPattern = /(?:@|&#64;)(?:\s|&nbsp;|<[^>]+>)*descricaodia(?:\s|&nbsp;|<[^>]+>)*(?:=|&#61;)(?:\s|&nbsp;|<[^>]+>)*(\d+)/gi;
  const withDailyLogs = withTechTeam.replace(dailyLogTagPattern, (_match, rawId) => {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return _match;
    return renderDailyLogInlineItem(dailyLogsById.get(id), id, nestedContext);
  });
  const dailyLogsTagAllPattern = /(?:@|&#64;)(?:\s|&nbsp;|<[^>]+>)*descricaodia(?!((?:\s|&nbsp;|<[^>]+>)*(?:=|&#61;)))/gi;
  const dailyLogsForAll = dailyLogsOrdered.filter((l) => String(l.notes || "").trim() !== "conclusaogeral");
  const withAllDailyLogs = withDailyLogs.replace(dailyLogsTagAllPattern, () => renderAllDailyLogsInlineItems(dailyLogsForAll, nestedContext));
  const conclusaoGeralLog = dailyLogsOrdered.find((l) => String(l.notes || "").trim() === "conclusaogeral");
  const conclusaoGeralTagPattern = /(?:@|&#64;)(?:\s|&nbsp;|<[^>]+>)*conclusaogeral/gi;
  const withConclusaoGeral = withAllDailyLogs.replace(conclusaoGeralTagPattern, () =>
    conclusaoGeralLog ? renderDailyLogInlineItem(conclusaoGeralLog, conclusaoGeralLog.id, nestedContext) : ""
  );
  return wrapImageCardsIntoRows(withConclusaoGeral);
}

function buildPreviewModel(payload, options = {}) {
  const reportConfig = options && options.reportConfig && typeof options.reportConfig === "object"
    ? options.reportConfig
    : {};
  const templateKey = String(options && options.templateKey ? options.templateKey : reportConfig.templateKey || "").trim().toLowerCase();
  const rawOrder = payload.order || {};
  const order = withServiceOrderDisplay(rawOrder);
  const siteData = payload.site && typeof payload.site === "object" ? payload.site : {};
  const rawReport = payload.report || {};
  const signatures = Array.isArray(payload.signatures) ? payload.signatures : [];
  const vextromSignatures = signatures
    .filter((item) => String(item && item.signer_type || "").toLowerCase() === "vextrom_technician")
    .sort((a, b) => {
      const aDate = new Date(a && (a.signed_at || a.created_at || a.updated_at) || 0).getTime();
      const bDate = new Date(b && (b.signed_at || b.created_at || b.updated_at) || 0).getTime();
      if (aDate !== bDate) return bDate - aDate;
      return Number(b && b.id || 0) - Number(a && a.id || 0);
    });
  const signedTechnicianName = String(vextromSignatures[0] && vextromSignatures[0].signer_name || "").trim();
  const preparedByRaw = String(rawReport.prepared_by || "").trim();
  const systemUserFallback = String(rawOrder.created_by || rawOrder.updated_by || "").trim();
  const report = {
    ...rawReport,
    prepared_by: signedTechnicianName || preparedByRaw || systemUserFallback
  };
  const documentLang = String(rawReport.document_language || "pt").trim().toLowerCase();
  const uiLabels = REPORT_UI_LABELS[documentLang] || REPORT_UI_LABELS.pt;
  const images = Array.isArray(payload.images) ? payload.images : [];
  const imageById = new Map(
    images
      .filter((item) => Number.isInteger(Number(item?.ref_id || item?.id)) && String(item?.file_path || "").trim())
      .map((item) => [
        Number(item.ref_id || item.id),
        {
          id: Number(item.ref_id || item.id),
          filePath: String(item.file_path || "").trim(),
          caption: String(item.caption || "").trim()
        }
      ])
  );
  const imagesBySection = images.reduce((acc, item) => {
    const key = String(item?.section_key || "").trim().toLowerCase();
    const filePath = String(item?.file_path || "").trim();
    if (!key || !filePath) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  Object.keys(imagesBySection).forEach((key) => {
    imagesBySection[key].sort(
      (a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id || 0) - Number(b.id || 0)
    );
  });

  const sections = payload.sections || [];
  const previewSections = Array.isArray(sections) ? sections : [];
  const orderEquipments = Array.isArray(payload.orderEquipments) ? payload.orderEquipments : [];
  const equipmentById = new Map(
    orderEquipments
      .filter((item) => Number.isInteger(Number(item?.ref_id || item?.equipment_id)))
      .map((item) => [
        Number(item.ref_id || item.equipment_id),
        {
          id: Number(item.ref_id || item.equipment_id),
          tag: String(item.tag_number || "").trim(),
          type: String(item.type || "").trim(),
          serial: String(item.serial_number || "").trim()
        }
      ])
  );
  const componentItems = Array.isArray(payload.components) ? payload.components : [];
  const timesheetItems = Array.isArray(payload.timesheet) ? payload.timesheet : [];
  const technicianItems = Array.isArray(payload.technicians) ? payload.technicians : [];
  const dailyLogsOrdered = (Array.isArray(payload.dailyLogs) ? payload.dailyLogs : [])
    .filter((item) => Number.isInteger(Number(item?.id)) && Number(item.id) > 0)
    .map((item) => ({
      id: Number(item.id),
      orderSeq: Number(item.order_seq || item.id),
      activityDate: item.activity_date || "",
      title: item.title || "",
      content: item.content || "",
      notes: item.notes || ""
    }));
  const dailyLogsById = new Map(
    dailyLogsOrdered
      .filter((item) => Number.isInteger(item.orderSeq) && item.orderSeq > 0)
      .map((item) => [item.orderSeq, item])
  );
  const visibleSections = previewSections
    .filter((item) => item?.is_visible !== false)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id || 0) - Number(b.id || 0));
  const orderedVisibleSections = (visibleSections.length ? visibleSections : previewSections)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id || 0) - Number(b.id || 0))
    .map((section, index) => {
      const sectionKey = String(section.section_key || "").trim().toLowerCase();
      const anchorKey = sectionKey.replace(/[^a-z0-9_]+/g, "-") || "secao";
      const anchorId = `section-${index + 1}-${anchorKey}`;
      const fromRegistry = imagesBySection[sectionKey] || [];
      let sectionImages = [];
      if (fromRegistry.length) {
        sectionImages = fromRegistry.map((item) => ({
          id: item.ref_id || item.id,
          filePath: toImagePublicSrc(item.file_path),
          caption: item.caption || "",
          sortOrder: item.sort_order
        }));
      } else {
        if (section.image_left_path) {
          sectionImages.push({
            id: null,
            filePath: toImagePublicSrc(section.image_left_path),
            caption: `${uiLabels.image} 1`,
            sortOrder: 1
          });
        }
        if (section.image_right_path) {
          sectionImages.push({
            id: null,
            filePath: toImagePublicSrc(section.image_right_path),
            caption: `${uiLabels.image} 2`,
            sortOrder: 2
          });
        }
      }

      return {
        ...section,
        anchor_id: anchorId,
        sectionImages,
        section_title_html_preview: injectTaggedImagesInHtml(
          section.section_title_html || `<p>${section.section_title || "-"}</p>`,
          imageById,
          componentItems,
          equipmentById,
          timesheetItems,
          dailyLogsById,
          dailyLogsOrdered,
          { imageLabel: uiLabels.image },
          technicianItems,
          orderEquipments,
          siteData
        ),
        content_html_preview: injectTaggedImagesInHtml(
          section.content_html || "<p><br></p>",
          imageById,
          componentItems,
          equipmentById,
          timesheetItems,
          dailyLogsById,
          dailyLogsOrdered,
          { imageLabel: uiLabels.image },
          technicianItems,
          orderEquipments,
          siteData
        ),
        section_title_html: section.section_title_html || `<p>${section.section_title || "-"}</p>`,
        section_title_text: section.section_title_text || section.section_title || "-",
        image_left_path: section.image_left_path || "",
        image_right_path: section.image_right_path || ""
      };
    });
  const sectionMap = {
    scope: getSectionContent(previewSections, "scope"),
    technicalDescription: getSectionContent(previewSections, "technical_description"),
    replacedComponents: getSectionContent(previewSections, "replaced_components"),
    requiredComponents: getSectionContent(previewSections, "required_components"),
    recommendedSpare: getSectionContent(previewSections, "recommended_spare"),
    recommendations: getSectionContent(previewSections, "recommendations"),
    conclusion: getSectionContent(previewSections, "conclusion")
  };
  const components = groupComponents(payload.components || []);

  const footerHtml = String(reportConfig && reportConfig.footerHtml != null ? reportConfig.footerHtml : "").trim();

  return {
    ...payload,
    report,
    order,
    orderedVisibleSections,
    signatures: Array.isArray(payload.signatures) ? payload.signatures : [],
    uiLabels,
    footerHtml,
    brandAssets: {
      logoVextrom: String(reportConfig.logoVextrom || process.env.SERVICE_REPORT_LOGO_VEXTROM || "/public/img/logo-vextrom.svg"),
      logoChloride: String(reportConfig.logoChloride || process.env.SERVICE_REPORT_LOGO_CHLORIDE || "").trim(),
      logoCover: String(
        reportConfig.logoCover
        || process.env.SERVICE_REPORT_LOGO_COVER
        || reportConfig.logoVextrom
        || process.env.SERVICE_REPORT_LOGO_VEXTROM
        || "/public/img/logo-vextrom.svg"
      ).trim(),
      chartMtbf: String(process.env.SERVICE_REPORT_CHART_MTBF || "").trim()
    },
    reportTemplateKey: templateKey || "modern",
    sectionMap,
    components,
    toc: orderedVisibleSections.map((item, index) => ({
      title: normalizeTocTitle(item),
      startPage: index + 3,
      anchorId: item.anchor_id || ""
    })),
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  buildPreviewModel
};
