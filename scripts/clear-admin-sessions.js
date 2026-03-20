const { invalidateAllAdminSessions } = require("../specflow/services/adminSessionState");

function run() {
  const cutOff = invalidateAllAdminSessions();
  // eslint-disable-next-line no-console
  console.log(`Todas as sessoes admin foram invalidadas. Corte: ${new Date(cutOff).toISOString()}`);
  process.exit(0);
}

try {
  run();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("Falha ao invalidar sessoes admin:", err.message);
  process.exit(1);
}

