const sanitizeHtml = require("sanitize-html");

const DEFAULT_EMPTY_DELTA = {
  ops: [{ insert: "\n" }]
};

const INLINE_FORMATS = new Set(["bold", "italic", "underline", "link", "font", "size", "color"]);
const BLOCK_ALIGN_VALUES = new Set(["center", "right", "justify"]);
const HEADER_VALUES = new Set([1, 2, 3]);
const LIST_VALUES = new Set(["ordered", "bullet"]);
const FONT_VALUES = new Set(["arial", "serif", "monospace"]);
const SIZE_VALUES = new Set(["small", "large", "huge"]);
const COLOR_REGEXES = [
  /^#[0-9a-f]{3,8}$/i,
  /^rgb\(\s*(\d{1,3}\s*,\s*){2}\d{1,3}\s*\)$/i,
  /^rgba\(\s*(\d{1,3}\s*,\s*){3}(0|0?\.\d+|1(\.0+)?)\s*\)$/i,
  /^hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*\)$/i,
  /^hsla\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*,\s*(0|0?\.\d+|1(\.0+)?)\s*\)$/i,
  /^[a-z]{3,20}$/i
];

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeLink(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const safe = sanitizeHtml(raw, {
    allowedTags: [],
    allowedAttributes: {}
  });
  if (/^(https?:|mailto:|tel:)/i.test(safe)) return safe;
  return "";
}

function sanitizeImageEmbedUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const safe = sanitizeHtml(raw, {
    allowedTags: [],
    allowedAttributes: {}
  });
  if (/^https?:\/\//i.test(safe)) return safe;
  if (/^data:image\//i.test(safe)) return safe;
  return "";
}

function parseBool(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (Array.isArray(value)) {
    if (!value.length) return fallback;
    return parseBool(value[value.length - 1], fallback);
  }
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "on", "yes"].includes(normalized);
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function extractTextFromHtml(html) {
  return sanitizeHtml(String(html || ""), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeReportSectionHtml(inputHtml) {
  return sanitizeHtml(String(inputHtml || ""), {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "u",
      "ul",
      "ol",
      "li",
      "blockquote",
      "h1",
      "h2",
      "h3",
      "a",
      "img",
      "span",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "colgroup",
      "col"
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "class", "style"],
      p: ["class", "style"],
      li: ["class", "style"],
      h1: ["class", "style"],
      h2: ["class", "style"],
      h3: ["class", "style"],
      blockquote: ["class", "style"],
      span: ["class", "style"],
      table: ["class", "style"],
      thead: ["class", "style"],
      tbody: ["class", "style"],
      tr: ["class", "style"],
      th: ["class", "style", "colspan", "rowspan"],
      td: ["class", "style", "colspan", "rowspan"],
      colgroup: ["class", "style"],
      col: ["class", "style", "span", "width"]
    },
    allowedClasses: {
      p: ["ql-align-center", "ql-align-right", "ql-align-justify"],
      li: ["ql-align-center", "ql-align-right", "ql-align-justify"],
      h1: ["ql-align-center", "ql-align-right", "ql-align-justify"],
      h2: ["ql-align-center", "ql-align-right", "ql-align-justify"],
      h3: ["ql-align-center", "ql-align-right", "ql-align-justify"],
      blockquote: ["ql-align-center", "ql-align-right", "ql-align-justify"],
      span: [
        "ql-align-center",
        "ql-align-right",
        "ql-align-justify",
        "ql-font-arial",
        "ql-font-serif",
        "ql-font-monospace",
        "ql-size-small",
        "ql-size-large",
        "ql-size-huge"
      ]
    },
    allowedStyles: {
      p: {
        "text-transform": [/^(none|uppercase|lowercase|capitalize)$/i]
      },
      li: {
        "text-transform": [/^(none|uppercase|lowercase|capitalize)$/i]
      },
      h1: {
        "text-transform": [/^(none|uppercase|lowercase|capitalize)$/i]
      },
      h2: {
        "text-transform": [/^(none|uppercase|lowercase|capitalize)$/i]
      },
      h3: {
        "text-transform": [/^(none|uppercase|lowercase|capitalize)$/i]
      },
      blockquote: {
        "text-transform": [/^(none|uppercase|lowercase|capitalize)$/i]
      },
      span: {
        color: COLOR_REGEXES,
        "text-transform": [/^(none|uppercase|lowercase|capitalize)$/i]
      },
      table: {
        width: [/^[0-9.]+(%|px|rem|em)$/i],
        "table-layout": [/^(auto|fixed)$/i]
      },
      th: {
        width: [/^[0-9.]+(%|px|rem|em)$/i],
        "text-align": [/^(left|center|right|justify)$/i],
        "vertical-align": [/^(top|middle|bottom)$/i],
        "background-color": COLOR_REGEXES,
        color: COLOR_REGEXES,
        border: [/^[^;]{1,80}$/]
      },
      td: {
        width: [/^[0-9.]+(%|px|rem|em)$/i],
        "text-align": [/^(left|center|right|justify)$/i],
        "vertical-align": [/^(top|middle|bottom)$/i],
        "background-color": COLOR_REGEXES,
        color: COLOR_REGEXES,
        border: [/^[^;]{1,80}$/]
      },
      img: {
        width: [/^[0-9.]+(%|px|rem|em|vw|vh)$/i],
        height: [/^[0-9.]+(%|px|rem|em|vw|vh|auto)$/i],
        "max-width": [/^[0-9.]+(%|px|rem|em|vw|vh)$/i],
        "object-fit": [/^(contain|cover|fill|none|scale-down)$/i]
      }
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"]
    },
    allowProtocolRelative: false
  }).trim();
}

function sanitizeReportTitleHtml(inputHtml) {
  return sanitizeHtml(String(inputHtml || ""), {
    allowedTags: ["p", "strong", "em", "u", "a", "img", "span", "br"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "class", "style"],
      p: ["class", "style"],
      span: ["class", "style"]
    },
    allowedClasses: {
      p: ["ql-align-center", "ql-align-right", "ql-align-justify"],
      span: [
        "ql-align-center",
        "ql-align-right",
        "ql-align-justify",
        "ql-font-arial",
        "ql-font-serif",
        "ql-font-monospace",
        "ql-size-small",
        "ql-size-large",
        "ql-size-huge"
      ]
    },
    allowedStyles: {
      p: {
        "text-transform": [/^(none|uppercase|lowercase|capitalize)$/i]
      },
      span: {
        color: COLOR_REGEXES,
        "text-transform": [/^(none|uppercase|lowercase|capitalize)$/i]
      },
      img: {
        width: [/^[0-9.]+(%|px|rem|em|vw|vh)$/i],
        height: [/^[0-9.]+(%|px|rem|em|vw|vh|auto)$/i],
        "max-width": [/^[0-9.]+(%|px|rem|em|vw|vh)$/i],
        "object-fit": [/^(contain|cover|fill|none|scale-down)$/i]
      }
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"]
    },
    allowProtocolRelative: false
  }).trim();
}

function sanitizeImagePath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return raw;
  return "";
}

function buildDeltaFromText(value) {
  const text = normalizeText(value);
  return {
    ops: [{ insert: `${text}\n` }]
  };
}

function normalizeInlineAttributes(rawAttributes) {
  const source = rawAttributes && typeof rawAttributes === "object" ? rawAttributes : {};
  const attributes = {};
  if (source.bold) attributes.bold = true;
  if (source.italic) attributes.italic = true;
  if (source.underline) attributes.underline = true;
  if (FONT_VALUES.has(String(source.font || ""))) {
    attributes.font = String(source.font);
  }
  if (SIZE_VALUES.has(String(source.size || ""))) {
    attributes.size = String(source.size);
  }
  if (source.color) {
    const safeColor = sanitizeColor(source.color);
    if (safeColor) attributes.color = safeColor;
  }
  if (source.link) {
    const safeLink = sanitizeLink(source.link);
    if (safeLink) attributes.link = safeLink;
  }
  return attributes;
}

function sanitizeColor(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const safe = sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} });
  return COLOR_REGEXES.some((re) => re.test(safe)) ? safe : "";
}

function normalizeBlockAttributes(rawAttributes) {
  const source = rawAttributes && typeof rawAttributes === "object" ? rawAttributes : {};
  const attributes = {};
  if (HEADER_VALUES.has(Number(source.header))) {
    attributes.header = Number(source.header);
  }
  if (LIST_VALUES.has(String(source.list || ""))) {
    attributes.list = String(source.list);
  }
  if (String(source.blockquote || "").toLowerCase() === "true" || source.blockquote === true) {
    attributes.blockquote = true;
  }
  if (BLOCK_ALIGN_VALUES.has(String(source.align || ""))) {
    attributes.align = String(source.align);
  }
  return attributes;
}

function normalizeDeltaFromInput(rawDelta) {
  if (!rawDelta && rawDelta !== 0) return DEFAULT_EMPTY_DELTA;
  let parsed = rawDelta;
  if (typeof rawDelta === "string") {
    try {
      parsed = JSON.parse(rawDelta);
    } catch (_err) {
      const err = new Error("JSON Delta invalido.");
      err.statusCode = 422;
      throw err;
    }
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.ops)) {
    const err = new Error("Payload Delta invalido.");
    err.statusCode = 422;
    throw err;
  }
  if (parsed.ops.length > 4000) {
    const err = new Error("Delta excede limite de operacoes.");
    err.statusCode = 422;
    throw err;
  }

  const normalizedOps = [];
  parsed.ops.forEach((op) => {
    if (!op || typeof op !== "object") return;
    if (op.insert === undefined || op.insert === null) return;
    if (typeof op.insert !== "string") {
      const imageSrc = op.insert && typeof op.insert === "object"
        ? sanitizeImageEmbedUrl(op.insert.image)
        : "";
      if (imageSrc) {
        normalizedOps.push({
          insert: { image: imageSrc }
        });
        return;
      }
      const err = new Error("Delta contem operacao nao suportada.");
      err.statusCode = 422;
      throw err;
    }
    const text = op.insert.replace(/\r\n/g, "\n");
    if (!text) return;
    const safeAttrs = normalizeInlineAttributes(op.attributes);
    const safeBlockAttrs = normalizeBlockAttributes(op.attributes);
    const mergedAttrs = { ...safeAttrs, ...safeBlockAttrs };
    normalizedOps.push({
      insert: text,
      ...(Object.keys(mergedAttrs).length ? { attributes: mergedAttrs } : {})
    });
  });

  if (!normalizedOps.length) return DEFAULT_EMPTY_DELTA;
  return { ops: normalizedOps };
}

function applyInlineFormat(text, attrs = {}) {
  if (!text) return "";
  let out = escapeHtml(text);
  const classes = [];
  if (FONT_VALUES.has(String(attrs.font || ""))) classes.push(`ql-font-${attrs.font}`);
  if (SIZE_VALUES.has(String(attrs.size || ""))) classes.push(`ql-size-${attrs.size}`);
  const safeColor = sanitizeColor(attrs.color);
  const attrsHtml = [];
  if (classes.length) attrsHtml.push(`class="${classes.join(" ")}"`);
  if (safeColor) attrsHtml.push(`style="color: ${escapeHtml(safeColor)}"`);
  if (attrsHtml.length) out = `<span ${attrsHtml.join(" ")}>${out}</span>`;
  if (attrs.link) out = `<a href="${escapeHtml(attrs.link)}" target="_blank" rel="noopener noreferrer">${out}</a>`;
  if (attrs.bold) out = `<strong>${out}</strong>`;
  if (attrs.italic) out = `<em>${out}</em>`;
  if (attrs.underline) out = `<u>${out}</u>`;
  return out;
}

function alignClass(attrs = {}) {
  if (!attrs.align) return "";
  if (!BLOCK_ALIGN_VALUES.has(attrs.align)) return "";
  return ` class="ql-align-${attrs.align}"`;
}

function renderLineInline(segments = []) {
  if (!segments.length) return "<br>";
  return segments.map((segment) => {
    if (segment && segment.type === "image") {
      return `<img src="${escapeHtml(segment.src || "")}" alt="Imagem" />`;
    }
    return applyInlineFormat(segment.text, segment.attrs);
  }).join("");
}

function deltaToLines(delta) {
  const lines = [];
  let segments = [];

  function flush(blockAttrs = {}) {
    lines.push({
      inlineSegments: segments,
      blockAttrs
    });
    segments = [];
  }

  delta.ops.forEach((op) => {
    if (op && op.insert && typeof op.insert === "object" && op.insert.image) {
      const src = sanitizeImageEmbedUrl(op.insert.image);
      if (src) segments.push({ type: "image", src });
      return;
    }
    const text = String(op.insert || "");
    const attrs = op.attributes || {};
    const parts = text.split("\n");
    for (let i = 0; i < parts.length; i += 1) {
      const chunk = parts[i];
      if (chunk) {
        const inlineAttrs = {};
        Object.keys(attrs).forEach((key) => {
          if (INLINE_FORMATS.has(key)) inlineAttrs[key] = attrs[key];
        });
        segments.push({ text: chunk, attrs: inlineAttrs });
      }
      const isNewline = i < parts.length - 1;
      if (isNewline) {
        flush(normalizeBlockAttributes(attrs));
      }
    }
  });

  if (segments.length) flush({});
  if (!lines.length) {
    return [{ inlineSegments: [], blockAttrs: {} }];
  }
  return lines;
}

function convertDeltaToHtml(delta) {
  const lines = deltaToLines(delta);
  let html = "";
  let openList = "";

  function closeOpenList() {
    if (openList) {
      html += `</${openList}>`;
      openList = "";
    }
  }

  lines.forEach((line) => {
    const inline = renderLineInline(line.inlineSegments);
    const blockAttrs = line.blockAttrs || {};
    if (blockAttrs.list) {
      const listTag = blockAttrs.list === "ordered" ? "ol" : "ul";
      if (openList !== listTag) {
        closeOpenList();
        html += `<${listTag}>`;
        openList = listTag;
      }
      html += `<li${alignClass(blockAttrs)}>${inline}</li>`;
      return;
    }

    closeOpenList();
    if (blockAttrs.header) {
      html += `<h${blockAttrs.header}${alignClass(blockAttrs)}>${inline}</h${blockAttrs.header}>`;
      return;
    }
    if (blockAttrs.blockquote) {
      html += `<blockquote${alignClass(blockAttrs)}>${inline}</blockquote>`;
      return;
    }
    html += `<p${alignClass(blockAttrs)}>${inline}</p>`;
  });

  closeOpenList();
  return html || "<p><br></p>";
}

function normalizeSectionContent(input = {}, defaultTitle = "") {
  const hasDeltaInput = input.contentDeltaJson !== undefined && input.contentDeltaJson !== null && input.contentDeltaJson !== "";
  const htmlInput = input.contentHtml !== undefined ? input.contentHtml : input.content;
  const hasHtmlInput = htmlInput !== undefined && htmlInput !== null && String(htmlInput).trim() !== "";
  let normalizedDelta = DEFAULT_EMPTY_DELTA;
  let normalizedHtml = "<p><br></p>";
  let normalizedText = "";

  if (hasHtmlInput) {
    normalizedHtml = sanitizeReportSectionHtml(htmlInput) || "<p><br></p>";
    normalizedText = extractTextFromHtml(normalizedHtml);
    normalizedDelta = hasDeltaInput ? normalizeDeltaFromInput(input.contentDeltaJson) : buildDeltaFromText(normalizedText);
  } else if (hasDeltaInput) {
    normalizedDelta = normalizeDeltaFromInput(input.contentDeltaJson);
    normalizedHtml = sanitizeReportSectionHtml(convertDeltaToHtml(normalizedDelta)) || "<p><br></p>";
    normalizedText = extractTextFromHtml(normalizedHtml);
  } else {
    normalizedText = normalizeText(input.contentText);
    normalizedDelta = buildDeltaFromText(normalizedText);
    normalizedHtml = normalizedText ? `<p>${escapeHtml(normalizedText)}</p>` : "<p><br></p>";
  }

  let titleDelta = buildDeltaFromText(defaultTitle || "");
  let titleHtml = sanitizeReportTitleHtml(`<p>${escapeHtml(defaultTitle || "")}</p>`) || `<p>${escapeHtml(defaultTitle || "")}</p>`;
  let titleText = normalizeText(defaultTitle || "");
  const hasTitleDeltaInput = input.sectionTitleDeltaJson !== undefined && input.sectionTitleDeltaJson !== null && input.sectionTitleDeltaJson !== "";
  const hasTitleHtmlInput = input.sectionTitleHtml !== undefined && input.sectionTitleHtml !== null && String(input.sectionTitleHtml).trim() !== "";

  if (hasTitleDeltaInput) {
    titleDelta = normalizeDeltaFromInput(input.sectionTitleDeltaJson);
    titleHtml = sanitizeReportTitleHtml(convertDeltaToHtml(titleDelta)) || titleHtml;
    titleText = extractTextFromHtml(titleHtml);
  } else if (hasTitleHtmlInput) {
    titleHtml = sanitizeReportTitleHtml(input.sectionTitleHtml) || titleHtml;
    titleText = extractTextFromHtml(titleHtml) || titleText;
    titleDelta = buildDeltaFromText(titleText);
  } else if (input.sectionTitle || input.sectionTitleText) {
    titleText = normalizeText(input.sectionTitleText || input.sectionTitle || defaultTitle);
    titleDelta = buildDeltaFromText(titleText);
    titleHtml = sanitizeReportTitleHtml(`<p>${escapeHtml(titleText)}</p>`) || titleHtml;
  }

  return {
    sectionTitle: titleText || defaultTitle,
    sectionTitleDeltaJson: titleDelta,
    sectionTitleHtml: titleHtml,
    sectionTitleText: titleText || defaultTitle,
    contentDeltaJson: normalizedDelta,
    contentHtml: normalizedHtml,
    contentText: normalizedText,
    imageLeftPath: sanitizeImagePath(input.imageLeftPath || input.image_left_path),
    imageRightPath: sanitizeImagePath(input.imageRightPath || input.image_right_path),
    isVisible: parseBool(input.isVisible, true)
  };
}

module.exports = {
  DEFAULT_EMPTY_DELTA,
  buildDeltaFromText,
  normalizeDeltaFromInput,
  convertDeltaToHtml,
  sanitizeReportSectionHtml,
  sanitizeReportTitleHtml,
  extractTextFromHtml,
  sanitizeImagePath,
  normalizeSectionContent
};
