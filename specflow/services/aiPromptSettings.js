const db = require("../db");

const AI_PROMPT_TEMPLATE_KEY = "ai.profile.prompt_template";

async function getAiPromptTemplate() {
  const result = await db.query("SELECT value FROM app_settings WHERE key = $1", [AI_PROMPT_TEMPLATE_KEY]);
  const value = result.rows[0] && typeof result.rows[0].value === "string" ? result.rows[0].value : "";
  return value.trim();
}

async function setAiPromptTemplate(value) {
  const normalized = String(value || "").trim();
  await db.query(
    `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [AI_PROMPT_TEMPLATE_KEY, normalized]
  );
  return normalized;
}

module.exports = {
  getAiPromptTemplate,
  setAiPromptTemplate
};

