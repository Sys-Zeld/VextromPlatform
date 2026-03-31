const repo = require("../report_service/src/repositories/serviceReportRepository");

function parseInput(raw) {
  const value = String(raw || "").trim();
  const match = value.match(/^(\d{1,8}):(\d{2}|\d{4})$/);
  if (!match) return null;

  const sequence = Number(match[1]);
  const yearToken = match[2];
  const year = yearToken.length === 2 ? Number(`20${yearToken}`) : Number(yearToken);
  if (!Number.isInteger(sequence) || sequence <= 0) return null;
  if (!Number.isInteger(year) || year < 2000 || year > 9999) return null;

  return { sequence, year };
}

async function run() {
  const input = parseInput(process.argv[2]);
  if (!input) {
    // eslint-disable-next-line no-console
    console.error("Uso: npm run report-service:os:init -- 1234:26");
    process.exit(1);
    return;
  }

  await repo.setOrderCodeSeed(input.year, input.sequence);

  const nextSequence = await repo.getOrderCodeSequence(input.year);
  const shortYear = String(input.year).slice(-2);
  // eslint-disable-next-line no-console
  console.log(`Seed OS atualizado: ${String(input.sequence).padStart(4, "0")}:${shortYear}`);
  // eslint-disable-next-line no-console
  console.log(`Proxima sequencia efetiva para ${input.year}: ${nextSequence}`);
  process.exit(0);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Falha ao inicializar numero de OS:", err.message);
  process.exit(1);
});

