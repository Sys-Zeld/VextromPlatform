function requireText(value, fieldLabel) {
  const text = String(value || "").trim();
  if (!text) {
    const err = new Error(`${fieldLabel} e obrigatorio.`);
    err.statusCode = 422;
    throw err;
  }
  return text;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

module.exports = {
  requireText,
  parseOptionalNumber
};
