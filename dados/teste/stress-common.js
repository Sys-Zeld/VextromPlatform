function readNumberArg(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number(raw.slice(prefix.length));
  if (!Number.isInteger(value) || value < min) return fallback;
  return Math.min(value, max);
}

async function runWorkers(total, concurrency, workerTask) {
  const shared = { next: 0, ok: 0, fail: 0 };
  await Promise.all(
    Array.from({ length: concurrency }, (_, idx) => workerTask(total, shared, idx + 1))
  );
  return shared;
}

function logWorkerOk(workerId, index, total, details = "") {
  const suffix = details ? ` ${details}` : "";
  // eslint-disable-next-line no-console
  console.log(`[worker ${workerId}] OK ${index}/${total}${suffix}`);
}

function logWorkerFail(workerId, index, total, error) {
  const message = error && error.message ? error.message : String(error || "erro desconhecido");
  // eslint-disable-next-line no-console
  console.error(`[worker ${workerId}] FAIL ${index}/${total}: ${message}`);
}

module.exports = {
  readNumberArg,
  runWorkers,
  logWorkerOk,
  logWorkerFail
};

