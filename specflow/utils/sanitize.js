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

function sanitizeRichTextInput(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRichTextInput(item));
  }
  if (value === null || value === undefined) {
    return "";
  }
  return sanitizeHtml(String(value), {
    allowedTags: ["p", "br", "strong", "em", "u", "s", "ul", "ol", "li", "blockquote", "a", "h1", "h2"],
    allowedAttributes: {
      a: ["href", "target", "rel"]
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href"]
  }).trim();
}

module.exports = {
  sanitizeInput,
  sanitizeRichTextInput
};
