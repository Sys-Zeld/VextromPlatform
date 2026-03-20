const { toInteger } = require("./normalizers");

function normalizePagination(query = {}) {
  const limit = Math.min(100, Math.max(1, toInteger(query.limit, 20)));
  const offset = Math.max(0, toInteger(query.offset, 0));
  return { limit, offset };
}

module.exports = {
  normalizePagination
};
