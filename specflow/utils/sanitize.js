const sanitizeHtml = require("sanitize-html");

function sanitizeInput(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeInput(item));
  }
  if (value === null || value === undefined) {
    return "";
  }
  return sanitizeHtml(String(value), {
    allowedTags: [],
    allowedAttributes: {}
  }).trim();
}

module.exports = {
  sanitizeInput
};
