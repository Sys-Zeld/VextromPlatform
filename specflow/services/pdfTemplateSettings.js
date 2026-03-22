const crypto = require("crypto");
const db = require("../db");

const PDF_TEMPLATE_SETTING_KEYS = {
  templates: "pdf.templates.list",
  defaultByTheme: "pdf.templates.default_by_theme"
};

const SUPPORTED_PDF_THEMES = ["soft", "vextrom", "xvextrom"];

const DEFAULT_THEME_PALETTES = {
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

const COLOR_FIELDS = [
  "cardBackground",
  "borderColor",
  "titleColor",
  "headerColor",
  "textColor",
  "rowEvenBackground",
  "rowOddBackground",
  "lineColor",
  "badgeBackground",
  "badgeBorder",
  "badgeText"
];

function normalizeTheme(theme) {
  const normalized = String(theme || "").trim().toLowerCase();
  if (SUPPORTED_PDF_THEMES.includes(normalized)) return normalized;
  if (normalized === "xvetrom") return "xvextrom";
  return "soft";
}

function normalizeHexColor(value, fallback) {
  const source = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(source)) return source;
  return fallback;
}

function normalizePdfPalette(theme, palette) {
  const themeKey = normalizeTheme(theme);
  const base = DEFAULT_THEME_PALETTES[themeKey] || DEFAULT_THEME_PALETTES.soft;
  const source = palette && typeof palette === "object" ? palette : {};
  const output = {};
  COLOR_FIELDS.forEach((fieldKey) => {
    output[fieldKey] = normalizeHexColor(source[fieldKey], base[fieldKey]);
  });
  return output;
}

function normalizeTemplateRecord(input, index = 0) {
  const source = input && typeof input === "object" ? input : {};
  const theme = normalizeTheme(source.theme);
  return {
    id: String(source.id || "").trim() || `pdf_tpl_${index + 1}`,
    name: String(source.name || "").trim() || `Template PDF ${index + 1}`,
    theme,
    palette: normalizePdfPalette(theme, source.palette),
    createdAt: String(source.createdAt || source.created_at || ""),
    updatedAt: String(source.updatedAt || source.updated_at || "")
  };
}

function parseTemplates(raw) {
  const source = String(raw || "").trim();
  if (!source) return [];
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item, index) => normalizeTemplateRecord(item, index));
  } catch (_err) {
    return [];
  }
}

function parseDefaultByTheme(raw) {
  const fallback = { soft: "", vextrom: "", xvextrom: "" };
  const source = String(raw || "").trim();
  if (!source) return fallback;
  try {
    const parsed = JSON.parse(source);
    const obj = parsed && typeof parsed === "object" ? parsed : {};
    return {
      soft: String(obj.soft || "").trim(),
      vextrom: String(obj.vextrom || "").trim(),
      xvextrom: String(obj.xvextrom || obj.xvetrom || "").trim()
    };
  } catch (_err) {
    return fallback;
  }
}

async function getSettingsMap(keys) {
  const result = await db.query(
    `
      SELECT key, value
      FROM app_settings
      WHERE key = ANY($1::text[])
    `,
    [keys]
  );
  return result.rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

async function upsertSetting(key, value) {
  await db.query(
    `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [key, String(value ?? "")]
  );
}

function ensureThemeDefaults(templates, currentDefaults) {
  const defaults = {
    soft: String(currentDefaults.soft || ""),
    vextrom: String(currentDefaults.vextrom || ""),
    xvextrom: String(currentDefaults.xvextrom || "")
  };
  SUPPORTED_PDF_THEMES.forEach((theme) => {
    const hasCurrent = templates.some((tpl) => tpl.id === defaults[theme] && tpl.theme === theme);
    if (hasCurrent) return;
    const fallback = templates.find((tpl) => tpl.theme === theme);
    defaults[theme] = fallback ? fallback.id : "";
  });
  return defaults;
}

function serializeTemplates(templates) {
  return JSON.stringify(Array.isArray(templates) ? templates : [], null, 2);
}

async function getPdfTemplateSettings() {
  const keys = Object.values(PDF_TEMPLATE_SETTING_KEYS);
  const settings = await getSettingsMap(keys);
  const templates = parseTemplates(settings[PDF_TEMPLATE_SETTING_KEYS.templates]);
  const defaults = ensureThemeDefaults(
    templates,
    parseDefaultByTheme(settings[PDF_TEMPLATE_SETTING_KEYS.defaultByTheme])
  );
  return {
    templates,
    defaultsByTheme: defaults
  };
}

async function savePdfTemplate({ templateId = "", name, theme, palette = {} }) {
  const cleanName = String(name || "").trim();
  const themeKey = normalizeTheme(theme);
  if (!cleanName) {
    const err = new Error("Informe um nome para o template PDF.");
    err.statusCode = 422;
    throw err;
  }

  const { templates, defaultsByTheme } = await getPdfTemplateSettings();
  const nowIso = new Date().toISOString();
  const normalizedId = String(templateId || "").trim();
  const normalizedPalette = normalizePdfPalette(themeKey, palette);
  let saved = null;

  const existingIndex = normalizedId ? templates.findIndex((item) => item.id === normalizedId) : -1;
  if (existingIndex >= 0) {
    const current = templates[existingIndex];
    saved = {
      ...current,
      name: cleanName,
      theme: themeKey,
      palette: normalizedPalette,
      updatedAt: nowIso
    };
    templates[existingIndex] = saved;
  } else {
    saved = {
      id: crypto.randomUUID(),
      name: cleanName,
      theme: themeKey,
      palette: normalizedPalette,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    templates.push(saved);
  }

  const defaults = ensureThemeDefaults(templates, defaultsByTheme);
  if (!defaults[themeKey]) {
    defaults[themeKey] = saved.id;
  }

  await Promise.all([
    upsertSetting(PDF_TEMPLATE_SETTING_KEYS.templates, serializeTemplates(templates)),
    upsertSetting(PDF_TEMPLATE_SETTING_KEYS.defaultByTheme, JSON.stringify(defaults, null, 2))
  ]);

  return saved;
}

async function setDefaultPdfTemplateForTheme({ templateId, theme }) {
  const normalizedId = String(templateId || "").trim();
  const themeKey = normalizeTheme(theme);
  if (!normalizedId) {
    const err = new Error("Template PDF invalido.");
    err.statusCode = 422;
    throw err;
  }

  const { templates, defaultsByTheme } = await getPdfTemplateSettings();
  const selected = templates.find((item) => item.id === normalizedId);
  if (!selected) {
    const err = new Error("Template PDF nao encontrado.");
    err.statusCode = 404;
    throw err;
  }
  if (selected.theme !== themeKey) {
    const err = new Error("Template selecionado nao pertence ao tema informado.");
    err.statusCode = 422;
    throw err;
  }

  const nextDefaults = { ...defaultsByTheme, [themeKey]: selected.id };
  await upsertSetting(PDF_TEMPLATE_SETTING_KEYS.defaultByTheme, JSON.stringify(nextDefaults, null, 2));
}

async function deletePdfTemplate(templateId) {
  const normalizedId = String(templateId || "").trim();
  if (!normalizedId) {
    const err = new Error("Template PDF invalido.");
    err.statusCode = 422;
    throw err;
  }

  const { templates, defaultsByTheme } = await getPdfTemplateSettings();
  const existing = templates.find((item) => item.id === normalizedId);
  if (!existing) {
    const err = new Error("Template PDF nao encontrado.");
    err.statusCode = 404;
    throw err;
  }

  const updatedTemplates = templates.filter((item) => item.id !== normalizedId);
  const nextDefaults = ensureThemeDefaults(updatedTemplates, defaultsByTheme);

  await Promise.all([
    upsertSetting(PDF_TEMPLATE_SETTING_KEYS.templates, serializeTemplates(updatedTemplates)),
    upsertSetting(PDF_TEMPLATE_SETTING_KEYS.defaultByTheme, JSON.stringify(nextDefaults, null, 2))
  ]);
}

async function resolvePdfTemplateForTheme(theme) {
  const themeKey = normalizeTheme(theme);
  const { templates, defaultsByTheme } = await getPdfTemplateSettings();
  const preferredId = String(defaultsByTheme[themeKey] || "");
  const selectedById = templates.find((item) => item.id === preferredId && item.theme === themeKey);
  const fallbackByTheme = templates.find((item) => item.theme === themeKey);
  const selected = selectedById || fallbackByTheme;
  if (!selected) {
    return {
      id: "",
      name: `Padrao ${themeKey}`,
      theme: themeKey,
      palette: normalizePdfPalette(themeKey, {})
    };
  }
  return {
    ...selected,
    theme: themeKey,
    palette: normalizePdfPalette(themeKey, selected.palette)
  };
}

module.exports = {
  SUPPORTED_PDF_THEMES,
  normalizeTheme,
  normalizePdfPalette,
  getPdfTemplateSettings,
  savePdfTemplate,
  setDefaultPdfTemplateForTheme,
  deletePdfTemplate,
  resolvePdfTemplateForTheme
};
