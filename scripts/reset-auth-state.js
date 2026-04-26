const db = require("../specflow/db");
const {
  invalidateAllAdminSessions,
  requestAllRateLimitersReset
} = require("../specflow/services/adminSessionState");

async function run() {
  const sessionCutOff = invalidateAllAdminSessions();
  const limiterResetAt = requestAllRateLimitersReset();
  const result = await db.query("DELETE FROM token_creation_audit");

  // eslint-disable-next-line no-console
  console.log("Estado de autenticacao e rate limit resetado.");
  // eslint-disable-next-line no-console
  console.log(`Sessoes admin invalidas antes de: ${new Date(sessionCutOff).toISOString()}`);
  // eslint-disable-next-line no-console
  console.log(`Reset dos rate limiters em memoria solicitado em: ${new Date(limiterResetAt).toISOString()}`);
  // eslint-disable-next-line no-console
  console.log(`Registros persistidos de rate limit removidos: ${result.rowCount || 0}`);
  // eslint-disable-next-line no-console
  console.log("Observacao: limiters em memoria de processos Node ativos sao zerados na proxima requisicao recebida pelo app.");
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Falha ao resetar autenticacao/rate limit:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end();
    } catch (_err) {
      // noop
    }
  });
