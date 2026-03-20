function getFactValue(context, path) {
  const factPath = String(path || "").trim();
  if (!factPath) return undefined;
  return factPath.split(".").reduce((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return acc[key];
  }, context);
}

module.exports = {
  getFactValue
};
