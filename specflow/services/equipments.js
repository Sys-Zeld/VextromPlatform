const { v4: uuidv4 } = require("uuid");
const db = require("../db");

function normalizeEquipmentRow(row) {
  return {
    id: Number(row.id),
    token: row.token,
    purchaser: row.purchaser || "",
    purchaserContact: row.purchaser_contact || "",
    contactEmail: row.contact_email || "",
    contactPhone: row.contact_phone || "",
    projectName: row.project_name || "",
    siteName: row.site_name || "",
    address: row.address || "",
    profileId: row.profile_id ? Number(row.profile_id) : null,
    profileName: row.profile_name || null,
    status: row.status || "draft",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeFieldIds(fieldIds) {
  const list = Array.isArray(fieldIds) ? fieldIds : [];
  const unique = new Set();
  list.forEach((item) => {
    const id = Number(item);
    if (Number.isInteger(id) && id > 0) {
      unique.add(id);
    }
  });
  return Array.from(unique);
}

async function createEquipment({
  purchaser,
  purchaserContact,
  contactEmail = "",
  contactPhone = "",
  projectName = "",
  siteName = "",
  address = "",
  profileId = null,
  enabledFieldIds = null
}) {
  const token = uuidv4().replace(/-/g, "");
  const cleanProfileId = Number.isInteger(Number(profileId)) && Number(profileId) > 0 ? Number(profileId) : null;
  const cleanEnabledFieldIds = enabledFieldIds === null ? null : normalizeFieldIds(enabledFieldIds);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
        INSERT INTO equipments (
          token,
          purchaser,
          purchaser_contact,
          contact_email,
          contact_phone,
          project_name,
          site_name,
          address,
          profile_id,
          status,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', NOW(), NOW())
        RETURNING *
      `,
      [
        token,
        purchaser || "",
        purchaserContact || "",
        contactEmail || "",
        contactPhone || "",
        projectName || "",
        siteName || "",
        address || "",
        cleanProfileId
      ]
    );
    const equipment = normalizeEquipmentRow(result.rows[0]);

    if (Array.isArray(cleanEnabledFieldIds)) {
      for (const fieldId of cleanEnabledFieldIds) {
        await client.query(
          `
            INSERT INTO equipment_enabled_fields (equipment_id, field_id, created_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (equipment_id, field_id) DO NOTHING
          `,
          [equipment.id, fieldId]
        );
      }
    }

    await client.query("COMMIT");
    return equipment;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getEquipmentById(id) {
  const result = await db.query(
    `
      SELECT e.*, p.name AS profile_name
      FROM equipments e
      LEFT JOIN field_profiles p ON p.id = e.profile_id
      WHERE e.id = $1
    `,
    [id]
  );
  return result.rows[0] ? normalizeEquipmentRow(result.rows[0]) : null;
}

async function getEquipmentByToken(token) {
  const result = await db.query(
    `
      SELECT e.*, p.name AS profile_name
      FROM equipments e
      LEFT JOIN field_profiles p ON p.id = e.profile_id
      WHERE e.token = $1
    `,
    [token]
  );
  return result.rows[0] ? normalizeEquipmentRow(result.rows[0]) : null;
}

async function listEquipments() {
  const result = await db.query(
    `
      SELECT e.*, p.name AS profile_name
      FROM equipments e
      LEFT JOIN field_profiles p ON p.id = e.profile_id
      ORDER BY e.created_at DESC
    `
  );
  return result.rows.map(normalizeEquipmentRow);
}

async function updateEquipmentStatus(id, status) {
  await db.query("UPDATE equipments SET status = $2, updated_at = NOW() WHERE id = $1", [id, status]);
}

async function updateEquipmentClientData(id, {
  purchaser,
  purchaserContact,
  contactEmail = "",
  contactPhone = "",
  projectName = "",
  siteName = "",
  address = ""
}) {
  await db.query(
    `
      UPDATE equipments
      SET purchaser = $2,
          purchaser_contact = $3,
          contact_email = $4,
          contact_phone = $5,
          project_name = $6,
          site_name = $7,
          address = $8,
          updated_at = NOW()
      WHERE id = $1
    `,
    [id, purchaser || "", purchaserContact || "", contactEmail || "", contactPhone || "", projectName || "", siteName || "", address || ""]
  );
}

async function deleteEquipmentById(id) {
  const result = await db.query("DELETE FROM equipments WHERE id = $1", [id]);
  return result.rowCount > 0;
}

async function getEnabledFieldIdsForEquipment(equipmentId) {
  const result = await db.query(
    "SELECT field_id FROM equipment_enabled_fields WHERE equipment_id = $1 ORDER BY field_id ASC",
    [equipmentId]
  );
  return result.rows.map((row) => Number(row.field_id));
}

async function updateEquipmentConfiguration(id, {
  purchaser,
  purchaserContact,
  contactEmail = "",
  contactPhone = "",
  projectName = "",
  siteName = "",
  address = "",
  profileId = null,
  enabledFieldIds = []
}) {
  const cleanProfileId = Number.isInteger(Number(profileId)) && Number(profileId) > 0 ? Number(profileId) : null;
  const cleanEnabledFieldIds = normalizeFieldIds(enabledFieldIds);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE equipments
        SET purchaser = $2,
            purchaser_contact = $3,
            contact_email = $4,
            contact_phone = $5,
            project_name = $6,
            site_name = $7,
            address = $8,
            profile_id = $9,
            updated_at = NOW()
        WHERE id = $1
      `,
      [id, purchaser || "", purchaserContact || "", contactEmail || "", contactPhone || "", projectName || "", siteName || "", address || "", cleanProfileId]
    );
    await client.query("DELETE FROM equipment_enabled_fields WHERE equipment_id = $1", [id]);
    for (const fieldId of cleanEnabledFieldIds) {
      await client.query(
        `
          INSERT INTO equipment_enabled_fields (equipment_id, field_id, created_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (equipment_id, field_id) DO NOTHING
        `,
        [id, fieldId]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createEquipment,
  getEquipmentById,
  getEquipmentByToken,
  listEquipments,
  updateEquipmentClientData,
  updateEquipmentConfiguration,
  updateEquipmentStatus,
  deleteEquipmentById,
  getEnabledFieldIdsForEquipment
};
