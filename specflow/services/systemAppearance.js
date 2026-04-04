const db = require("../../configdb/db");
const DEFAULT_SYSTEM_FONT_KEY = "inter";

const FONT_OPTIONS = [
  {
    key: "inter",
    name: "Inter (atual)",
    family: "\"Inter\", \"Segoe UI\", Tahoma, sans-serif",
    description: "Equilibrada e neutra para formularios densos."
  },
  {
    key: "manrope",
    name: "Manrope",
    family: "\"Manrope\", \"Segoe UI\", Tahoma, sans-serif",
    description: "Mais tecnica e limpa, boa para dashboards."
  },
  {
    key: "nunito",
    name: "Nunito",
    family: "\"Nunito\", \"Segoe UI\", Tahoma, sans-serif",
    description: "Mais amigavel, melhora leitura em textos longos."
  },
  {
    key: "source-sans-3",
    name: "Source Sans 3",
    family: "\"Source Sans 3\", \"Segoe UI\", Tahoma, sans-serif",
    description: "Excelente legibilidade em interfaces administrativas."
  },
  {
    key: "ibm-plex-sans",
    name: "IBM Plex Sans",
    family: "\"IBM Plex Sans\", \"Segoe UI\", Tahoma, sans-serif",
    description: "Visual corporativo e consistente para dados tabulares."
  }
];

const ALLOWED_FONT_KEYS = new Set(FONT_OPTIONS.map((option) => option.key));

function normalizeSystemFontKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (ALLOWED_FONT_KEYS.has(normalized)) {
    return normalized;
  }
  return DEFAULT_SYSTEM_FONT_KEY;
}

async function getUserSystemFontKey(username) {
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername) return DEFAULT_SYSTEM_FONT_KEY;
  try {
    const result = await db.query(
      `
        SELECT ui_font
        FROM admin_users
        WHERE username = $1
        LIMIT 1
      `,
      [normalizedUsername]
    );
    return normalizeSystemFontKey(result.rows[0]?.ui_font);
  } catch (err) {
    if (err && (err.code === "42P01" || err.code === "42703")) {
      return DEFAULT_SYSTEM_FONT_KEY;
    }
    throw err;
  }
}

async function setUserSystemFontKey(username, fontKey) {
  const normalizedUsername = String(username || "").trim();
  const normalized = normalizeSystemFontKey(fontKey);
  if (!normalizedUsername) {
    throw new Error("Usuario invalido para salvar preferencia de fonte.");
  }
  const result = await db.query(
    `
      UPDATE admin_users
      SET ui_font = $2, updated_at = NOW()
      WHERE username = $1
      RETURNING username
    `,
    [normalizedUsername, normalized]
  );
  if (!result.rows[0]) {
    throw new Error("Usuario nao encontrado na tabela admin_users para salvar fonte.");
  }
  return normalized;
}

function listSystemFontOptions() {
  return FONT_OPTIONS.map((option) => ({ ...option }));
}

module.exports = {
  DEFAULT_SYSTEM_FONT_KEY,
  normalizeSystemFontKey,
  getUserSystemFontKey,
  setUserSystemFontKey,
  listSystemFontOptions
};
