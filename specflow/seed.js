const { migrate } = require("./db/migrate");
const { seedAnnexDFields } = require("./services/fieldSeed");
const { ensureSpecflowDefaults } = require("./seed-defaults");

async function seedSpecflow() {
  await migrate();
  const seeded = await seedAnnexDFields({ overwrite: true });
  const defaults = await ensureSpecflowDefaults();
  return {
    total: seeded.total,
    defaults
  };
}

module.exports = {
  seedSpecflow
};

if (require.main === module) {
  seedSpecflow()
    .then((seeded) => {
      // eslint-disable-next-line no-console
      console.log(
        `SpecFlow seed concluido. campos=${seeded.total} perfil=${seeded.defaults.profile.profileName} (${seeded.defaults.profile.created ? "created" : "updated"}) cliente=${seeded.defaults.client.equipmentId} (${seeded.defaults.client.created ? "created" : "updated"})`
      );
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("SpecFlow seed failed:", err.message);
      process.exit(1);
    });
}
