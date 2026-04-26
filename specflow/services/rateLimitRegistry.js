const rateLimit = require("express-rate-limit");
const { getRateLimiterResetAfter } = require("./adminSessionState");

const registeredStores = [];
let lastAppliedReset = 0;

function createResettableRateLimit(name, options) {
  const store = new rateLimit.MemoryStore();
  registeredStores.push({ name, store });
  return rateLimit({
    ...options,
    store
  });
}

function resetRegisteredRateLimitersIfRequested() {
  const requestedAt = getRateLimiterResetAfter();
  if (!requestedAt || requestedAt <= lastAppliedReset) {
    return { applied: false, requestedAt, resetCount: 0 };
  }

  let resetCount = 0;
  for (const item of registeredStores) {
    if (item.store && typeof item.store.resetAll === "function") {
      item.store.resetAll();
      resetCount += 1;
    }
  }

  lastAppliedReset = requestedAt;
  return { applied: true, requestedAt, resetCount };
}

module.exports = {
  createResettableRateLimit,
  resetRegisteredRateLimitersIfRequested
};
