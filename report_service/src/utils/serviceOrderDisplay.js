function normalizeYear(value, fallbackYear = "") {
  const direct = String(value || "").trim();
  if (/^\d{4}$/.test(direct)) return direct;
  if (/^\d{2}$/.test(direct)) return `20${direct}`;
  const fallback = String(fallbackYear || "").trim();
  if (/^\d{4}$/.test(fallback)) return fallback;
  if (/^\d{2}$/.test(fallback)) return `20${fallback}`;
  return "";
}

function parseOrderCode(rawCode, rawYear) {
  const code = String(rawCode || "").trim();
  if (!code) return { sequence: "", year: normalizeYear(rawYear, "") };

  const yearFromCode = code.match(/(19|20)\d{2}/)?.[0] || "";
  const trailingParts = code.match(/(\d+)[^\d]+(\d+)$/);

  if (trailingParts) {
    const maybeYear = normalizeYear(trailingParts[1], yearFromCode || rawYear);
    return {
      sequence: String(trailingParts[2] || "").padStart(3, "0"),
      year: maybeYear
    };
  }

  const numericParts = code.match(/\d+/g) || [];
  if (!numericParts.length) {
    return { sequence: "", year: normalizeYear(rawYear, yearFromCode) };
  }

  const sequence = String(numericParts[numericParts.length - 1] || "").padStart(3, "0");
  const year = normalizeYear(rawYear, yearFromCode);
  return { sequence, year };
}

function formatServiceOrderNumber(rawCode, rawYear) {
  const { sequence, year } = parseOrderCode(rawCode, rawYear);
  const shortYear = year ? String(year).slice(-2) : "";
  if (sequence && shortYear) return `${sequence}:${shortYear}`;
  if (sequence) return sequence;
  if (shortYear) return shortYear;
  return "-";
}

function formatServiceOrderDisplay(rawCode, rawYear) {
  const number = formatServiceOrderNumber(rawCode, rawYear);
  if (number === "-") return "-";
  return `OS:${number}`;
}

function withServiceOrderDisplay(order) {
  if (!order || typeof order !== "object") return order;
  const number = formatServiceOrderNumber(order.service_order_code, order.year);
  return {
    ...order,
    service_order_number: number,
    service_order_display: number === "-" ? "-" : `OS:${number}`
  };
}

module.exports = {
  formatServiceOrderNumber,
  formatServiceOrderDisplay,
  withServiceOrderDisplay
};
