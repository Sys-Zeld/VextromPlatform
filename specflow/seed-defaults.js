const db = require("./db");
const { listProfiles, listBaseFields, createProfile, updateProfile } = require("./services/profiles");
const { createEquipment, getEquipmentById, updateEquipmentConfiguration } = require("./services/equipments");

const DEFAULT_PROFILE_NAME = "PADRAO CHLORIDE";
const DEFAULT_CLIENT = {
  purchaser: "Cliente Padrao SpecFlow",
  purchaserContact: "Contato Padrao",
  contactEmail: "cliente.padrao@specflow.local",
  contactPhone: "+55 11 99999-0000",
  projectName: "Projeto Padrao SpecFlow",
  siteName: "Site Padrao",
  address: "Endereco Padrao"
};

async function ensureDefaultProfile() {
  const baseFields = await listBaseFields();
  const fieldIds = baseFields.map((field) => Number(field.fieldId)).filter((id) => Number.isInteger(id) && id > 0);
  const profiles = await listProfiles();
  const existing = profiles.find((item) => item.name === DEFAULT_PROFILE_NAME);

  if (existing) {
    const updated = await updateProfile(existing.id, {
      name: DEFAULT_PROFILE_NAME,
      fieldIds
    });
    return {
      created: false,
      profileId: Number(updated.id),
      profileName: DEFAULT_PROFILE_NAME,
      fieldIds
    };
  }

  const created = await createProfile({
    name: DEFAULT_PROFILE_NAME,
    fieldIds
  });
  return {
    created: true,
    profileId: Number(created.id),
    profileName: DEFAULT_PROFILE_NAME,
    fieldIds
  };
}

async function findDefaultClientByMarker() {
  const result = await db.query(
    `
      SELECT id
      FROM equipments
      WHERE purchaser = $1
        AND project_name = $2
      ORDER BY id ASC
      LIMIT 1
    `,
    [DEFAULT_CLIENT.purchaser, DEFAULT_CLIENT.projectName]
  );
  return result.rows[0] ? Number(result.rows[0].id) : null;
}

async function ensureDefaultClient({ profileId, fieldIds }) {
  const existingId = await findDefaultClientByMarker();

  if (!existingId) {
    const created = await createEquipment({
      ...DEFAULT_CLIENT,
      profileId,
      enabledFieldIds: fieldIds
    });
    return {
      created: true,
      equipmentId: Number(created.id),
      token: created.token
    };
  }

  const existing = await getEquipmentById(existingId);
  await updateEquipmentConfiguration(existingId, {
    purchaser: existing.purchaser || DEFAULT_CLIENT.purchaser,
    purchaserContact: existing.purchaserContact || DEFAULT_CLIENT.purchaserContact,
    contactEmail: existing.contactEmail || DEFAULT_CLIENT.contactEmail,
    contactPhone: existing.contactPhone || DEFAULT_CLIENT.contactPhone,
    projectName: existing.projectName || DEFAULT_CLIENT.projectName,
    siteName: existing.siteName || DEFAULT_CLIENT.siteName,
    address: existing.address || DEFAULT_CLIENT.address,
    profileId,
    enabledFieldIds: fieldIds
  });

  const updated = await getEquipmentById(existingId);
  return {
    created: false,
    equipmentId: Number(existingId),
    token: updated?.token || null
  };
}

async function ensureSpecflowDefaults() {
  const profile = await ensureDefaultProfile();
  const client = await ensureDefaultClient({
    profileId: profile.profileId,
    fieldIds: profile.fieldIds
  });
  return {
    profile,
    client
  };
}

module.exports = {
  DEFAULT_PROFILE_NAME,
  ensureSpecflowDefaults
};
