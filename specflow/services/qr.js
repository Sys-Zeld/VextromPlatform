const QRCode = require("qrcode");
const env = require("../config/env");

const QR_THEME_COLORS = {
  soft: "#0b3f73",
  vextrom: "#2f6f1f"
};

function buildSubmissionAccessLink(submissionToken, sections = []) {
  const cleanBaseUrl = String(env.appBaseUrl || "http://localhost:3000").replace(/\/+$/, "");
  return `${cleanBaseUrl}/form/${submissionToken}/specification`;
}

function normalizeQrTheme(theme) {
  return String(theme || "").toLowerCase() === "vextrom" ? "vextrom" : "soft";
}

async function buildSubmissionQrPayload(submissionToken, sections = [], theme = "soft") {
  const accessLink = buildSubmissionAccessLink(submissionToken, sections);
  const normalizedTheme = normalizeQrTheme(theme);
  const qrDataUrl = await QRCode.toDataURL(accessLink, {
    width: 220,
    margin: 1,
    color: {
      dark: QR_THEME_COLORS[normalizedTheme],
      light: "#ffffff"
    }
  });
  return { accessLink, qrDataUrl, theme: normalizedTheme };
}

module.exports = {
  buildSubmissionAccessLink,
  buildSubmissionQrPayload,
  normalizeQrTheme
};
