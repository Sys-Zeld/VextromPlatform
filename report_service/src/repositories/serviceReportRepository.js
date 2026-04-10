const db = require("../../db");
const { SECTION_DEFINITIONS, SECTION_SEED_HTML } = require("../constants");
const EMPTY_DELTA = { ops: [{ insert: "\n" }] };
const DEFAULT_SECTION_CONFIG_KEYS = {
  scope: "report.preview.sections.scope.default_html",
  recommendations: "report.preview.sections.recommendations.default_html"
};

function toInt(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function stripHtmlToText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deltaFromText(value) {
  const text = String(value || "").trim();
  return {
    ops: [{ insert: `${text}\n` }]
  };
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "on", "yes"].includes(normalized);
}

async function getOrderCodeSequence(year) {
  const normalizedYear = Number(year);
  const yearForSequence = Number.isInteger(normalizedYear) ? normalizedYear : new Date().getFullYear();
  const seed = await getOrderCodeSeed(yearForSequence);
  const result = await db.query(
    `
      SELECT COUNT(*)::int AS total
      FROM service_report_orders
      WHERE year = $1
    `,
    [yearForSequence]
  );
  const byCount = Number(result.rows[0]?.total || 0) + 1;
  return Math.max(byCount, seed || 0);
}

async function getAppSetting(key) {
  const result = await db.query(
    `
      SELECT value
      FROM service_report_app_settings
      WHERE key = $1
      LIMIT 1
    `,
    [String(key || "")]
  );
  return result.rows[0]?.value || null;
}

async function upsertAppSetting(key, value) {
  await db.query(
    `
      INSERT INTO service_report_app_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [String(key || ""), String(value || "")]
  );
}

function buildOrderSeedKey(year) {
  return `order.code.seed.${Number(year)}`;
}

async function getOrderCodeSeed(year) {
  const raw = await getAppSetting(buildOrderSeedKey(year));
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return 0;
  return parsed;
}

async function setOrderCodeSeed(year, sequence) {
  const numericYear = Number(year);
  const numericSequence = Number(sequence);
  if (!Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 9999) {
    const err = new Error("Ano invalido para seed de OS.");
    err.statusCode = 422;
    throw err;
  }
  if (!Number.isInteger(numericSequence) || numericSequence <= 0) {
    const err = new Error("Sequencia invalida para seed de OS.");
    err.statusCode = 422;
    throw err;
  }
  await upsertAppSetting(buildOrderSeedKey(numericYear), String(numericSequence));
}

async function listOrders() {
  const result = await db.query(
    `
      SELECT
        o.*,
        c.name AS customer_name,
        s.site_name AS site_name
      FROM service_report_orders o
      INNER JOIN service_report_customers c ON c.id = o.customer_id
      LEFT JOIN service_report_customer_sites s ON s.id = o.site_id
      ORDER BY o.created_at DESC, o.id DESC
    `
  );
  return result.rows;
}

async function getOrderById(id) {
  const result = await db.query(
    `
      SELECT
        o.*,
        c.name AS customer_name,
        s.site_name AS site_name
      FROM service_report_orders o
      INNER JOIN service_report_customers c ON c.id = o.customer_id
      LEFT JOIN service_report_customer_sites s ON s.id = o.site_id
      WHERE o.id = $1
      LIMIT 1
    `,
    [id]
  );
  return result.rows[0] || null;
}

async function createOrder(payload) {
  const result = await db.query(
    `
      INSERT INTO service_report_orders (
        service_order_code,
        year,
        customer_id,
        site_id,
        title,
        description,
        status,
        opening_date,
        closing_date,
        created_by,
        updated_by,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
      RETURNING *
    `,
    [
      payload.serviceOrderCode,
      payload.year,
      payload.customerId,
      payload.siteId,
      payload.title,
      payload.description || "",
      payload.status,
      payload.openingDate,
      payload.closingDate,
      payload.createdBy || "",
      payload.updatedBy || ""
    ]
  );
  return result.rows[0];
}

async function updateOrder(id, payload) {
  const result = await db.query(
    `
      UPDATE service_report_orders
      SET
        customer_id = $2,
        site_id = $3,
        title = $4,
        description = $5,
        status = $6,
        opening_date = $7,
        closing_date = $8,
        updated_by = $9,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      payload.customerId,
      payload.siteId,
      payload.title,
      payload.description || "",
      payload.status,
      payload.openingDate,
      payload.closingDate,
      payload.updatedBy || ""
    ]
  );
  return result.rows[0] || null;
}

async function deleteOrder(id) {
  const result = await db.query("DELETE FROM service_report_orders WHERE id = $1", [id]);
  return result.rowCount > 0;
}

async function listCustomers() {
  const result = await db.query(
    `
      SELECT *
      FROM service_report_customers
      ORDER BY name ASC, id ASC
    `
  );
  return result.rows;
}

async function getCustomerById(id) {
  const result = await db.query(
    "SELECT * FROM service_report_customers WHERE id = $1 LIMIT 1",
    [id]
  );
  return result.rows[0] || null;
}

async function createCustomer(payload) {
  const result = await db.query(
    `
      INSERT INTO service_report_customers (name, customer_type, notes, created_at, updated_at)
      VALUES ($1,$2,$3,NOW(),NOW())
      RETURNING *
    `,
    [payload.name, payload.customerType || "others", payload.notes || ""]
  );
  return result.rows[0];
}

async function deleteCustomer(id) {
  const result = await db.query(
    `DELETE FROM service_report_customers WHERE id = $1`,
    [id]
  );
  return result.rowCount > 0;
}

async function updateCustomer(id, payload) {
  const result = await db.query(
    `
      UPDATE service_report_customers
      SET
        name = $2,
        customer_type = $3,
        notes = $4,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, payload.name, payload.customerType || "others", payload.notes || ""]
  );
  return result.rows[0] || null;
}

async function listSites(filters = {}) {
  const values = [];
  const where = [];
  if (filters.customerId) {
    values.push(filters.customerId);
    where.push(`s.customer_id = $${values.length}`);
  }
  const result = await db.query(
    `
      SELECT
        s.*,
        c.name AS customer_name
      FROM service_report_customer_sites s
      INNER JOIN service_report_customers c ON c.id = s.customer_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY s.site_name ASC, s.id ASC
    `,
    values
  );
  return result.rows;
}

async function getSiteById(id) {
  const result = await db.query(
    `
      SELECT s.*, c.name AS customer_name
      FROM service_report_customer_sites s
      INNER JOIN service_report_customers c ON c.id = s.customer_id
      WHERE s.id = $1
      LIMIT 1
    `,
    [id]
  );
  return result.rows[0] || null;
}

async function createSite(payload) {
  const result = await db.query(
    `
      INSERT INTO service_report_customer_sites (
        customer_id,
        site_name,
        site_code,
        location,
        latitude,
        longitude,
        notes,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
      RETURNING *
    `,
    [
      payload.customerId,
      payload.siteName,
      payload.siteCode || "",
      payload.location || "",
      payload.latitude != null ? Number(payload.latitude) : null,
      payload.longitude != null ? Number(payload.longitude) : null,
      payload.notes || ""
    ]
  );
  return result.rows[0];
}

async function updateSite(id, payload) {
  const result = await db.query(
    `UPDATE service_report_customer_sites
     SET site_name=$2, site_code=$3, location=$4, latitude=$5, longitude=$6, notes=$7, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [
      id,
      payload.siteName,
      payload.siteCode || "",
      payload.location || "",
      payload.latitude != null ? Number(payload.latitude) : null,
      payload.longitude != null ? Number(payload.longitude) : null,
      payload.notes || ""
    ]
  );
  return result.rows[0] || null;
}

async function deleteSite(id) {
  const result = await db.query(
    `DELETE FROM service_report_customer_sites WHERE id = $1`,
    [id]
  );
  return result.rowCount > 0;
}

async function listEquipments() {
  const result = await db.query(
    `
      SELECT
        e.*,
        c.name AS customer_name,
        s.site_name
      FROM service_report_equipments e
      LEFT JOIN service_report_customers c ON c.id = e.customer_id
      LEFT JOIN service_report_customer_sites s ON s.id = e.site_id
      ORDER BY e.created_at DESC, e.id DESC
    `
  );
  return result.rows;
}

async function getEquipmentById(id) {
  const result = await db.query(
    `
      SELECT
        e.*,
        c.name AS customer_name,
        s.site_name
      FROM service_report_equipments e
      LEFT JOIN service_report_customers c ON c.id = e.customer_id
      LEFT JOIN service_report_customer_sites s ON s.id = e.site_id
      WHERE e.id = $1
      LIMIT 1
    `,
    [id]
  );
  return result.rows[0] || null;
}

async function createEquipment(payload) {
  const result = await db.query(
    `
      INSERT INTO service_report_equipments (
        customer_id,
        site_id,
        type,
        year_of_manufacture,
        serial_number,
        rated_ac_input_voltage,
        input_frequency,
        rated_dc_voltage,
        rated_ac_output_voltage,
        output_frequency,
        degree_of_protection,
        main_label,
        dt_number,
        tag_number,
        manufacturer,
        model_family,
        notes,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
      RETURNING *
    `,
    [
      payload.customerId,
      payload.siteId,
      payload.type,
      payload.yearOfManufacture || "",
      payload.serialNumber || "",
      payload.ratedAcInputVoltage || "",
      payload.inputFrequency || "",
      payload.ratedDcVoltage || "",
      payload.ratedAcOutputVoltage || "",
      payload.outputFrequency || "",
      payload.degreeOfProtection || "",
      payload.mainLabel || "",
      payload.dtNumber || "",
      payload.tagNumber || "",
      payload.manufacturer || "",
      payload.modelFamily || "",
      payload.notes || ""
    ]
  );
  return result.rows[0];
}

async function updateEquipment(id, payload) {
  const result = await db.query(
    `
      UPDATE service_report_equipments
      SET
        customer_id = $2,
        site_id = $3,
        type = $4,
        year_of_manufacture = $5,
        serial_number = $6,
        rated_ac_input_voltage = $7,
        input_frequency = $8,
        rated_dc_voltage = $9,
        rated_ac_output_voltage = $10,
        output_frequency = $11,
        degree_of_protection = $12,
        main_label = $13,
        dt_number = $14,
        tag_number = $15,
        manufacturer = $16,
        model_family = $17,
        notes = $18,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      payload.customerId,
      payload.siteId,
      payload.type,
      payload.yearOfManufacture || "",
      payload.serialNumber || "",
      payload.ratedAcInputVoltage || "",
      payload.inputFrequency || "",
      payload.ratedDcVoltage || "",
      payload.ratedAcOutputVoltage || "",
      payload.outputFrequency || "",
      payload.degreeOfProtection || "",
      payload.mainLabel || "",
      payload.dtNumber || "",
      payload.tagNumber || "",
      payload.manufacturer || "",
      payload.modelFamily || "",
      payload.notes || ""
    ]
  );
  return result.rows[0] || null;
}

async function deleteEquipment(id) {
  const result = await db.query(
    "DELETE FROM service_report_equipments WHERE id = $1",
    [id]
  );
  return result.rowCount > 0;
}

async function listSpareParts() {
  const result = await db.query(
    `
      SELECT *
      FROM service_report_spare_parts
      ORDER BY created_at DESC, id DESC
    `
  );
  return result.rows;
}

async function getSparePartById(id) {
  const result = await db.query(
    `
      SELECT *
      FROM service_report_spare_parts
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );
  return result.rows[0] || null;
}

async function createSparePart(payload) {
  const result = await db.query(
    `
      INSERT INTO service_report_spare_parts (
        description,
        manufacturer,
        equipment_model,
        part_number,
        lead_time,
        is_obsolete,
        replaced_by_part_number,
        equipment_family,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
      RETURNING *
    `,
    [
      payload.description,
      payload.manufacturer || "",
      payload.equipmentModel || "",
      payload.partNumber || "",
      payload.leadTime || "",
      Boolean(payload.isObsolete),
      payload.replacedByPartNumber || "",
      payload.equipmentFamily || ""
    ]
  );
  return result.rows[0];
}

async function updateSparePart(id, payload) {
  const result = await db.query(
    `
      UPDATE service_report_spare_parts
      SET
        description = $2,
        manufacturer = $3,
        equipment_model = $4,
        part_number = $5,
        lead_time = $6,
        is_obsolete = $7,
        replaced_by_part_number = $8,
        equipment_family = $9,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      payload.description,
      payload.manufacturer || "",
      payload.equipmentModel || "",
      payload.partNumber || "",
      payload.leadTime || "",
      Boolean(payload.isObsolete),
      payload.replacedByPartNumber || "",
      payload.equipmentFamily || ""
    ]
  );
  return result.rows[0] || null;
}

async function deleteSparePart(id) {
  const result = await db.query(
    `DELETE FROM service_report_spare_parts WHERE id = $1`,
    [id]
  );
  return result.rowCount > 0;
}

async function listSparePartsByEquipment(equipmentId) {
  const result = await db.query(
    `
      SELECT
        sp.*,
        link.quantity,
        link.created_at AS linked_at
      FROM service_report_equipment_spare_parts link
      INNER JOIN service_report_spare_parts sp ON sp.id = link.spare_part_id
      WHERE link.equipment_id = $1
      ORDER BY sp.description ASC, sp.id ASC
    `,
    [equipmentId]
  );
  return result.rows;
}

async function listSparePartsByEquipmentIds(equipmentIds = []) {
  const normalizedIds = (Array.isArray(equipmentIds) ? equipmentIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!normalizedIds.length) return [];

  const result = await db.query(
    `
      SELECT
        link.equipment_id,
        sp.*,
        link.quantity,
        link.created_at AS linked_at
      FROM service_report_equipment_spare_parts link
      INNER JOIN service_report_spare_parts sp ON sp.id = link.spare_part_id
      WHERE link.equipment_id = ANY($1::bigint[])
      ORDER BY link.equipment_id ASC, sp.description ASC, sp.id ASC
    `,
    [normalizedIds]
  );
  return result.rows;
}

async function linkSparePartToEquipment(equipmentId, sparePartId, quantity = 1) {
  const normalizedQuantity = Number.isInteger(Number(quantity)) && Number(quantity) > 0
    ? Number(quantity)
    : 1;
  await db.query(
    `
      INSERT INTO service_report_equipment_spare_parts (equipment_id, spare_part_id, quantity, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (equipment_id, spare_part_id)
      DO UPDATE SET quantity = EXCLUDED.quantity
    `,
    [equipmentId, sparePartId, normalizedQuantity]
  );
}

async function linkSparePartToEquipmentIfMissing(equipmentId, sparePartId, quantity = 1) {
  const normalizedQuantity = Number.isInteger(Number(quantity)) && Number(quantity) > 0
    ? Number(quantity)
    : 1;
  await db.query(
    `
      INSERT INTO service_report_equipment_spare_parts (equipment_id, spare_part_id, quantity, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (equipment_id, spare_part_id)
      DO NOTHING
    `,
    [equipmentId, sparePartId, normalizedQuantity]
  );
}

async function unlinkSparePartFromEquipment(equipmentId, sparePartId) {
  const result = await db.query(
    `
      DELETE FROM service_report_equipment_spare_parts
      WHERE equipment_id = $1 AND spare_part_id = $2
    `,
    [equipmentId, sparePartId]
  );
  return result.rowCount > 0;
}

async function updateSparePartQuantityByEquipment(equipmentId, sparePartId, quantity) {
  const normalizedQuantity = Number.isInteger(Number(quantity)) && Number(quantity) > 0
    ? Number(quantity)
    : 1;
  const result = await db.query(
    `
      UPDATE service_report_equipment_spare_parts
      SET quantity = $3
      WHERE equipment_id = $1 AND spare_part_id = $2
      RETURNING *
    `,
    [equipmentId, sparePartId, normalizedQuantity]
  );
  return result.rows[0] || null;
}

async function attachEquipmentToOrder(serviceOrderId, equipmentId, notes = "") {
  const result = await db.query(
    `
      WITH lock_order AS (
        SELECT id
        FROM service_report_orders
        WHERE id = $1
        FOR UPDATE
      ),
      next_ref AS (
        SELECT gs AS next_id
        FROM generate_series(
          1,
          COALESCE(
            (SELECT MAX(ref_id) FROM service_report_order_equipments WHERE service_order_id = $1),
            0
          ) + 1
        ) AS gs
        WHERE NOT EXISTS (
          SELECT 1
          FROM service_report_order_equipments oe2
          WHERE oe2.service_order_id = $1
            AND oe2.ref_id = gs
        )
        ORDER BY gs
        LIMIT 1
      )
      INSERT INTO service_report_order_equipments (service_order_id, equipment_id, ref_id, notes, created_at)
      VALUES ($1,$2,(SELECT next_id FROM next_ref),$3,NOW())
      ON CONFLICT (service_order_id, equipment_id)
      DO UPDATE SET notes = EXCLUDED.notes
      RETURNING *
    `,
    [serviceOrderId, equipmentId, notes]
  );
  return result.rows[0];
}

async function listOrderEquipments(serviceOrderId) {
  const result = await db.query(
    `
      SELECT
        oe.*,
        e.type,
        e.serial_number,
        e.tag_number,
        e.customer_id,
        e.site_id,
        e.year_of_manufacture,
        e.rated_ac_input_voltage,
        e.input_frequency,
        e.rated_dc_voltage,
        e.rated_ac_output_voltage,
        e.output_frequency,
        e.degree_of_protection,
        e.main_label,
        e.dt_number,
        e.manufacturer,
        e.model_family,
        e.notes AS equipment_notes,
        c.name AS customer_name,
        s.site_name
      FROM service_report_order_equipments oe
      INNER JOIN service_report_equipments e ON e.id = oe.equipment_id
      LEFT JOIN service_report_customers c ON c.id = e.customer_id
      LEFT JOIN service_report_customer_sites s ON s.id = e.site_id
      WHERE oe.service_order_id = $1
      ORDER BY oe.ref_id ASC, oe.id ASC
    `,
    [serviceOrderId]
  );
  return result.rows;
}

async function detachEquipmentFromOrder(serviceOrderId, equipmentId) {
  const result = await db.query(
    `
      DELETE FROM service_report_order_equipments
      WHERE service_order_id = $1 AND equipment_id = $2
    `,
    [serviceOrderId, equipmentId]
  );
  return result.rowCount > 0;
}

async function listTimesheetByOrder(serviceOrderId) {
  const result = await db.query(
    `
      SELECT *
      FROM service_report_timesheet_entries
      WHERE service_order_id = $1
      ORDER BY activity_date ASC, id ASC
    `,
    [serviceOrderId]
  );
  return result.rows;
}

async function createTimesheetEntry(payload) {
  const result = await db.query(
    `
      INSERT INTO service_report_timesheet_entries (
        service_order_id,
        activity_date,
        check_in_base,
        check_in_client,
        check_out_client,
        check_out_base,
        technician_name,
        worked_hours,
        notes,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
      RETURNING *
    `,
    [
      payload.serviceOrderId,
      payload.activityDate,
      payload.checkInBase || "",
      payload.checkInClient || "",
      payload.checkOutClient || "",
      payload.checkOutBase || "",
      payload.technicianName || "",
      payload.workedHours,
      payload.notes || ""
    ]
  );
  return result.rows[0];
}

async function updateTimesheetEntry(id, payload) {
  const result = await db.query(
    `
      UPDATE service_report_timesheet_entries
      SET
        activity_date = $2,
        check_in_base = $3,
        check_in_client = $4,
        check_out_client = $5,
        check_out_base = $6,
        technician_name = $7,
        worked_hours = $8,
        notes = $9,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      payload.activityDate,
      payload.checkInBase || "",
      payload.checkInClient || "",
      payload.checkOutClient || "",
      payload.checkOutBase || "",
      payload.technicianName || "",
      payload.workedHours,
      payload.notes || ""
    ]
  );
  return result.rows[0] || null;
}

async function deleteTimesheetEntry(id) {
  const result = await db.query(
    "DELETE FROM service_report_timesheet_entries WHERE id = $1",
    [id]
  );
  return result.rowCount > 0;
}

async function listDailyLogsByOrder(serviceOrderId) {
  const result = await db.query(
    `
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY service_order_id
          ORDER BY activity_date ASC, sort_order ASC, id ASC
        ) AS order_seq
      FROM service_report_daily_logs
      WHERE service_order_id = $1
      ORDER BY activity_date ASC, sort_order ASC, id ASC
    `,
    [serviceOrderId]
  );
  return result.rows;
}

async function createDailyLog(payload) {
  const result = await db.query(
    `
      INSERT INTO service_report_daily_logs (
        service_order_id,
        activity_date,
        title,
        content,
        notes,
        sort_order,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
      RETURNING *
    `,
    [
      payload.serviceOrderId,
      payload.activityDate,
      payload.title || "",
      payload.content || "",
      payload.notes || "",
      payload.sortOrder || 0
    ]
  );
  return result.rows[0];
}

async function getDailyLogByTagForOrder(serviceOrderId, tag) {
  const result = await db.query(
    `
      SELECT * FROM service_report_daily_logs
      WHERE service_order_id = $1 AND notes = $2
      ORDER BY id DESC LIMIT 1
    `,
    [serviceOrderId, tag]
  );
  return result.rows[0] || null;
}

async function updateDailyLogByOrderAndId(serviceOrderId, dailyLogId, payload) {
  const result = await db.query(
    `
      UPDATE service_report_daily_logs
      SET
        activity_date = $3,
        title = $4,
        content = $5,
        notes = $6,
        sort_order = $7,
        updated_at = NOW()
      WHERE id = $1
        AND service_order_id = $2
      RETURNING *
    `,
    [
      dailyLogId,
      serviceOrderId,
      payload.activityDate,
      payload.title || "",
      payload.content || "",
      payload.notes || "",
      payload.sortOrder || 0
    ]
  );
  return result.rows[0] || null;
}

async function deleteDailyLogByOrderAndId(serviceOrderId, dailyLogId) {
  const result = await db.query(
    `
      DELETE FROM service_report_daily_logs
      WHERE id = $1
        AND service_order_id = $2
    `,
    [dailyLogId, serviceOrderId]
  );
  return result.rowCount > 0;
}

async function listReports() {
  const result = await db.query(
    `
      SELECT
        r.*,
        o.service_order_code,
        o.title AS order_title
      FROM service_report_reports r
      INNER JOIN service_report_orders o ON o.id = r.service_order_id
      ORDER BY r.updated_at DESC, r.id DESC
    `
  );
  return result.rows;
}

async function getReportById(id) {
  const result = await db.query(
    `
      SELECT
        r.*,
        o.service_order_code,
        o.title AS order_title
      FROM service_report_reports r
      INNER JOIN service_report_orders o ON o.id = r.service_order_id
      WHERE r.id = $1
      LIMIT 1
    `,
    [id]
  );
  return result.rows[0] || null;
}

async function getReportByOrderId(serviceOrderId) {
  const result = await db.query(
    `
      SELECT
        r.*,
        o.service_order_code,
        o.title AS order_title
      FROM service_report_reports r
      INNER JOIN service_report_orders o ON o.id = r.service_order_id
      WHERE r.service_order_id = $1
      LIMIT 1
    `,
    [serviceOrderId]
  );
  return result.rows[0] || null;
}

async function createReport(payload) {
  const result = await db.query(
    `
      INSERT INTO service_report_reports (
        service_order_id,
        report_number,
        revision,
        title,
        status,
        issue_date,
        document_language,
        template_name,
        template_version,
        last_modified_at,
        prepared_by,
        reviewed_by,
        approved_by,
        pdf_path,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10,$11,$12,$13,NOW(),NOW())
      RETURNING *
    `,
    [
      payload.serviceOrderId,
      payload.reportNumber,
      payload.revision || "A",
      payload.title,
      payload.status || "draft",
      payload.issueDate,
      payload.documentLanguage || "pt",
      payload.templateName || "service-report-default",
      payload.templateVersion || "1.0.0",
      payload.preparedBy || "",
      payload.reviewedBy || "",
      payload.approvedBy || "",
      payload.pdfPath || ""
    ]
  );
  return result.rows[0];
}

async function updateReport(id, payload) {
  const result = await db.query(
    `
      UPDATE service_report_reports
      SET
        revision = $2,
        title = $3,
        status = $4,
        issue_date = $5,
        document_language = $6,
        template_name = $7,
        template_version = $8,
        prepared_by = $9,
        reviewed_by = $10,
        approved_by = $11,
        pdf_path = $12,
        last_modified_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      payload.revision || "A",
      payload.title,
      payload.status || "draft",
      payload.issueDate,
      payload.documentLanguage || "pt",
      payload.templateName || "service-report-default",
      payload.templateVersion || "1.0.0",
      payload.preparedBy || "",
      payload.reviewedBy || "",
      payload.approvedBy || "",
      payload.pdfPath || ""
    ]
  );
  return result.rows[0] || null;
}

async function ensureDefaultSections(serviceReportId) {
  const [configuredScopeHtml, configuredRecommendationsHtml] = await Promise.all([
    getAppSetting(DEFAULT_SECTION_CONFIG_KEYS.scope),
    getAppSetting(DEFAULT_SECTION_CONFIG_KEYS.recommendations)
  ]);
  const scopeHtmlFromSettings = configuredScopeHtml == null
    ? SECTION_SEED_HTML.scope
    : configuredScopeHtml;
  const recommendationsHtmlFromSettings = configuredRecommendationsHtml == null
    ? SECTION_SEED_HTML.recommendations
    : configuredRecommendationsHtml;
  const seededContentBySection = {
    scope: String(scopeHtmlFromSettings || ""),
    recommendations: String(recommendationsHtmlFromSettings || "")
  };
  const defaultSections = [
    { key: "scope", title: "ESCOPO", sortOrder: 1 },
    { key: "technical_description", title: "DESCRIÇÃO TECNICA", sortOrder: 2 },
    { key: "recommendations", title: "RECOMENDAÇÕES", sortOrder: 3 },
    { key: "conclusion", title: "CONCLUSÃO", sortOrder: 4 }
  ];
  for (const section of defaultSections) {
    const seededHtml = String(seededContentBySection[section.key] || "");
    const seededText = stripHtmlToText(seededHtml);
    const hasSeededContent = Boolean(seededHtml.trim());
    const contentDelta = hasSeededContent ? deltaFromText(seededText) : EMPTY_DELTA;
    const contentHtml = hasSeededContent ? seededHtml : "<p><br></p>";
    const contentText = hasSeededContent ? seededText : "";

    // eslint-disable-next-line no-await-in-loop
    await db.query(
      `
        INSERT INTO service_report_sections (
          service_report_id,
          section_key,
          section_title,
          section_title_delta_json,
          section_title_html,
          section_title_text,
          content_delta_json,
          content_html,
          content_text,
          image_left_path,
          image_right_path,
          sort_order,
          is_rich_text,
          is_visible,
          is_locked,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,TRUE,FALSE,NOW(),NOW())
        ON CONFLICT (service_report_id, section_key)
        DO NOTHING
      `,
      [
        serviceReportId,
        section.key,
        section.title,
        deltaFromText(section.title),
        `<p>${section.title}</p>`,
        section.title,
        contentDelta,
        contentHtml,
        contentText,
        "",
        "",
        section.sortOrder
      ]
    );

    if (hasSeededContent) {
      // Se a secao ja existir (conflito), aplica o seed quando o conteudo ainda estiver vazio.
      // Isso garante que scope/recommendations carreguem content_html padrao na criacao da OS.
      // eslint-disable-next-line no-await-in-loop
      await db.query(
        `
          UPDATE service_report_sections
          SET
            content_delta_json = $3,
            content_html = $4,
            content_text = $5,
            updated_at = NOW()
          WHERE service_report_id = $1
            AND section_key = $2
            AND (
              content_html IS NULL
              OR BTRIM(content_html) = ''
              OR content_html = '<p><br></p>'
              OR content_text IS NULL
              OR BTRIM(content_text) = ''
            )
        `,
        [
          serviceReportId,
          section.key,
          contentDelta,
          contentHtml,
          contentText
        ]
      );
    }
  }
}

async function listSections(serviceReportId) {
  const result = await db.query(
    `
      SELECT *
      FROM service_report_sections
      WHERE service_report_id = $1
      ORDER BY sort_order ASC, id ASC
    `,
    [serviceReportId]
  );
  return result.rows;
}

async function getSectionByKey(serviceReportId, sectionKey) {
  const result = await db.query(
    `
      SELECT *
      FROM service_report_sections
      WHERE service_report_id = $1 AND section_key = $2
      LIMIT 1
    `,
    [serviceReportId, sectionKey]
  );
  return result.rows[0] || null;
}

async function upsertSection(serviceReportId, sectionKey, payload = {}) {
  const match = SECTION_DEFINITIONS.find((section) => section.key === sectionKey);
  const title = payload.sectionTitle || match?.title || sectionKey;
  const sortOrder = Number.isFinite(Number(payload.sortOrder))
    ? Number(payload.sortOrder)
    : (match?.sortOrder || 99);
  await db.query(
    `
      INSERT INTO service_report_sections (
        service_report_id,
        section_key,
        section_title,
        section_title_delta_json,
        section_title_html,
        section_title_text,
        content_delta_json,
        content_html,
        content_text,
        image_left_path,
        image_right_path,
        sort_order,
        is_rich_text,
        is_visible,
        is_locked,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,$13,COALESCE($14,FALSE),NOW(),NOW())
      ON CONFLICT (service_report_id, section_key)
      DO UPDATE SET
        section_title = EXCLUDED.section_title,
        section_title_delta_json = EXCLUDED.section_title_delta_json,
        section_title_html = EXCLUDED.section_title_html,
        section_title_text = EXCLUDED.section_title_text,
        content_delta_json = EXCLUDED.content_delta_json,
        content_html = EXCLUDED.content_html,
        content_text = EXCLUDED.content_text,
        image_left_path = EXCLUDED.image_left_path,
        image_right_path = EXCLUDED.image_right_path,
        sort_order = EXCLUDED.sort_order,
        is_visible = EXCLUDED.is_visible,
        is_locked = EXCLUDED.is_locked,
        updated_at = NOW()
    `,
    [
      serviceReportId,
      sectionKey,
      title,
      payload.sectionTitleDeltaJson || deltaFromText(title),
      payload.sectionTitleHtml || `<p>${title}</p>`,
      payload.sectionTitleText || title,
      payload.contentDeltaJson || deltaFromText(payload.contentText || ""),
      payload.contentHtml || "",
      payload.contentText || "",
      payload.imageLeftPath || "",
      payload.imageRightPath || "",
      sortOrder,
      toBool(payload.isVisible, true),
      toBool(payload.isLocked, false)
    ]
  );
}

async function getNextSectionSortOrder(serviceReportId) {
  const result = await db.query(
    `
      SELECT COALESCE(MAX(sort_order), 0)::int AS max_order
      FROM service_report_sections
      WHERE service_report_id = $1
    `,
    [serviceReportId]
  );
  return Number(result.rows[0]?.max_order || 0) + 1;
}

async function createSection(serviceReportId, payload = {}) {
  const sortOrder = payload.sortOrder || await getNextSectionSortOrder(serviceReportId);
  const base = String(payload.sectionTitleText || payload.sectionTitle || "capitulo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "capitulo";

  let sectionKey = base;
  let attempt = 1;
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await getSectionByKey(serviceReportId, sectionKey);
    if (!existing) break;
    attempt += 1;
    sectionKey = `${base}_${attempt}`;
  }

  await upsertSection(serviceReportId, sectionKey, {
    ...payload,
    sortOrder
  });
  return getSectionByKey(serviceReportId, sectionKey);
}

async function reorderSections(serviceReportId, orderedKeys) {
  for (let i = 0; i < orderedKeys.length; i++) {
    await db.query(
      `UPDATE service_report_sections SET sort_order = $1, updated_at = NOW() WHERE service_report_id = $2 AND section_key = $3`,
      [i + 1, serviceReportId, orderedKeys[i]]
    );
  }
}

async function deleteSection(serviceReportId, sectionKey) {
  const result = await db.query(
    `
      DELETE FROM service_report_sections
      WHERE service_report_id = $1 AND section_key = $2
    `,
    [serviceReportId, sectionKey]
  );
  return result.rowCount > 0;
}

async function listComponents(serviceReportId) {
  const result = await db.query(
    `
      SELECT
        ci.*,
        e.type AS equipment_type,
        e.model_family AS equipment_model_family,
        e.serial_number AS equipment_serial,
        e.tag_number AS equipment_tag,
        e.dt_number AS equipment_dt,
        e.rated_ac_input_voltage AS equipment_power
      FROM service_report_component_items ci
      LEFT JOIN service_report_equipments e ON e.id = ci.equipment_id
      WHERE ci.service_report_id = $1
      ORDER BY ci.category ASC, ci.sort_order ASC, ci.id ASC
    `,
    [serviceReportId]
  );
  return result.rows;
}

async function createComponent(payload) {
  const result = await db.query(
    `
      INSERT INTO service_report_component_items (
        service_report_id,
        category,
        equipment_id,
        quantity,
        description,
        part_number,
        notes,
        sort_order,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
      RETURNING *
    `,
    [
      payload.serviceReportId,
      payload.category,
      payload.equipmentId,
      payload.quantity || 1,
      payload.description || "",
      payload.partNumber || "",
      payload.notes || "",
      payload.sortOrder || 0
    ]
  );
  return result.rows[0];
}

async function updateComponent(id, payload) {
  const result = await db.query(
    `
      UPDATE service_report_component_items
      SET
        category = $2,
        equipment_id = $3,
        quantity = $4,
        description = $5,
        part_number = $6,
        notes = $7,
        sort_order = $8,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      payload.category,
      payload.equipmentId,
      payload.quantity || 1,
      payload.description || "",
      payload.partNumber || "",
      payload.notes || "",
      payload.sortOrder || 0
    ]
  );
  return result.rows[0] || null;
}

async function deleteComponent(id) {
  const result = await db.query(
    "DELETE FROM service_report_component_items WHERE id = $1",
    [id]
  );
  return result.rowCount > 0;
}

async function listSignatures(serviceReportId) {
  const result = await db.query(
    `
      SELECT *
      FROM service_report_signatures
      WHERE service_report_id = $1
      ORDER BY id ASC
    `,
    [serviceReportId]
  );
  return result.rows;
}

async function createSignature(payload) {
  const result = await db.query(
    `
      INSERT INTO service_report_signatures (
        service_report_id,
        signer_type,
        signer_name,
        signer_role,
        signer_company,
        signature_data,
        signature_file_path,
        signed_at,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW(),NOW())
      RETURNING *
    `,
    [
      payload.serviceReportId,
      payload.signerType,
      payload.signerName,
      payload.signerRole || "",
      payload.signerCompany || "",
      payload.signatureData || "",
      payload.signatureFilePath || ""
    ]
  );
  return result.rows[0];
}

async function deleteSignature(id, serviceReportId = null) {
  const values = [id];
  let query = "DELETE FROM service_report_signatures WHERE id = $1";
  if (Number.isInteger(Number(serviceReportId)) && Number(serviceReportId) > 0) {
    values.push(Number(serviceReportId));
    query += " AND service_report_id = $2";
  }
  const result = await db.query(query, values);
  return result.rowCount > 0;
}

// ---- Sign Requests ----

async function createSignRequest(payload) {
  const result = await db.query(
    `
      INSERT INTO service_report_sign_requests (
        service_report_id, token, status,
        signer_name, signer_email, signer_role, signer_company,
        notes, expires_at, created_at, updated_at
      )
      VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, NOW() + INTERVAL '30 days', NOW(), NOW())
      RETURNING *
    `,
    [
      payload.serviceReportId,
      payload.token,
      payload.signerName || "",
      payload.signerEmail || "",
      payload.signerRole || "",
      payload.signerCompany || "",
      payload.notes || ""
    ]
  );
  return result.rows[0];
}

async function getSignRequestByToken(token) {
  const result = await db.query(
    `
      SELECT sr.*,
        rep.report_number, rep.title AS report_title, rep.status AS report_status,
        o.service_order_code, o.title AS order_title, o.id AS order_id,
        c.name AS customer_name
      FROM service_report_sign_requests sr
      JOIN service_report_reports rep ON rep.id = sr.service_report_id
      JOIN service_report_orders o ON o.id = rep.service_order_id
      JOIN service_report_customers c ON c.id = o.customer_id
      WHERE sr.token = $1
    `,
    [token]
  );
  return result.rows[0] || null;
}

async function listSignRequestsByReportId(serviceReportId) {
  const result = await db.query(
    `SELECT * FROM service_report_sign_requests WHERE service_report_id = $1 ORDER BY id DESC`,
    [serviceReportId]
  );
  return result.rows;
}

async function updateSignRequest(id, payload) {
  const fields = [];
  const values = [id];
  let idx = 2;

  if (payload.signerName !== undefined) { fields.push(`signer_name = $${idx++}`); values.push(payload.signerName); }
  if (payload.signerEmail !== undefined) { fields.push(`signer_email = $${idx++}`); values.push(payload.signerEmail); }
  if (payload.signerRole !== undefined) { fields.push(`signer_role = $${idx++}`); values.push(payload.signerRole); }
  if (payload.signerCompany !== undefined) { fields.push(`signer_company = $${idx++}`); values.push(payload.signerCompany); }
  if (payload.status !== undefined) { fields.push(`status = $${idx++}`); values.push(payload.status); }
  if (payload.signatureData !== undefined) { fields.push(`signature_data = $${idx++}`); values.push(payload.signatureData); }
  if (payload.signedAt !== undefined) { fields.push(`signed_at = $${idx++}`); values.push(payload.signedAt); }
  if (payload.ipAddress !== undefined) { fields.push(`ip_address = $${idx++}`); values.push(payload.ipAddress); }
  if (payload.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(payload.notes); }

  if (!fields.length) return null;
  fields.push(`updated_at = NOW()`);

  const result = await db.query(
    `UPDATE service_report_sign_requests SET ${fields.join(", ")} WHERE id = $1 RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

async function deleteSignRequest(id, serviceReportId = null) {
  const values = [id];
  let query = "DELETE FROM service_report_sign_requests WHERE id = $1";
  if (Number.isInteger(Number(serviceReportId)) && Number(serviceReportId) > 0) {
    values.push(Number(serviceReportId));
    query += " AND service_report_id = $2";
  }
  const result = await db.query(query, values);
  return result.rowCount > 0;
}

// ---- Global Technicians ----

async function listGlobalTechnicians() {
  const result = await db.query(
    `SELECT * FROM service_report_global_technicians ORDER BY name ASC, id ASC`
  );
  return result.rows;
}

async function createGlobalTechnician(payload) {
  const result = await db.query(
    `INSERT INTO service_report_global_technicians (name, role, company, email, phone, is_lead, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) RETURNING *`,
    [payload.name, payload.role || "", payload.company || "", payload.email || "", payload.phone || "", Boolean(payload.isLead)]
  );
  return result.rows[0];
}

async function updateGlobalTechnician(id, payload) {
  const result = await db.query(
    `UPDATE service_report_global_technicians
     SET name=$2, role=$3, company=$4, email=$5, phone=$6, is_lead=$7, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [id, payload.name, payload.role || "", payload.company || "", payload.email || "", payload.phone || "", Boolean(payload.isLead)]
  );
  return result.rows[0] || null;
}

async function deleteGlobalTechnician(id) {
  const result = await db.query(
    `DELETE FROM service_report_global_technicians WHERE id=$1`, [id]
  );
  return result.rowCount > 0;
}

// ---- Global Instruments ----

async function listGlobalInstruments() {
  const result = await db.query(
    `SELECT * FROM service_report_global_instruments ORDER BY name ASC, id ASC`
  );
  return result.rows;
}

async function createGlobalInstrument(payload) {
  const result = await db.query(
    `INSERT INTO service_report_global_instruments (name, model, serial_number, calibration_due_date, notes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW(),NOW()) RETURNING *`,
    [payload.name, payload.model || "", payload.serialNumber || "", payload.calibrationDueDate || null, payload.notes || ""]
  );
  return result.rows[0];
}

async function updateGlobalInstrument(id, payload) {
  const result = await db.query(
    `UPDATE service_report_global_instruments
     SET name=$2, model=$3, serial_number=$4, calibration_due_date=$5, notes=$6, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [id, payload.name, payload.model || "", payload.serialNumber || "", payload.calibrationDueDate || null, payload.notes || ""]
  );
  return result.rows[0] || null;
}

async function deleteGlobalInstrument(id) {
  const result = await db.query(
    `DELETE FROM service_report_global_instruments WHERE id=$1`, [id]
  );
  return result.rowCount > 0;
}

// ---- Order <-> Technician / Instrument links ----

async function listTechniciansByOrder(orderId) {
  const result = await db.query(
    `SELECT t.* FROM service_report_global_technicians t
     JOIN service_report_order_technicians ot ON ot.technician_id = t.id
     WHERE ot.order_id = $1 ORDER BY t.name ASC`,
    [orderId]
  );
  return result.rows;
}

async function linkTechnicianToOrder(orderId, technicianId) {
  await db.query(
    `INSERT INTO service_report_order_technicians (order_id, technician_id)
     VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [orderId, technicianId]
  );
}

async function unlinkTechnicianFromOrder(orderId, technicianId) {
  await db.query(
    `DELETE FROM service_report_order_technicians WHERE order_id=$1 AND technician_id=$2`,
    [orderId, technicianId]
  );
}

async function replaceTechniciansByOrder(orderId, technicianIds = []) {
  const normalizedIds = Array.from(new Set(
    (Array.isArray(technicianIds) ? technicianIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
  ));
  await db.query(`DELETE FROM service_report_order_technicians WHERE order_id = $1`, [orderId]);
  for (const technicianId of normalizedIds) {
    // eslint-disable-next-line no-await-in-loop
    await linkTechnicianToOrder(orderId, technicianId);
  }
}

async function listOrderTechnicianLinks(orderIds = []) {
  const normalizedOrderIds = Array.from(new Set(
    (Array.isArray(orderIds) ? orderIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
  ));
  if (!normalizedOrderIds.length) return [];
  const result = await db.query(
    `
      SELECT order_id, technician_id
      FROM service_report_order_technicians
      WHERE order_id = ANY($1::int[])
      ORDER BY order_id ASC, technician_id ASC
    `,
    [normalizedOrderIds]
  );
  return result.rows;
}

async function listInstrumentsByOrder(orderId) {
  const result = await db.query(
    `SELECT i.* FROM service_report_global_instruments i
     JOIN service_report_order_instruments oi ON oi.instrument_id = i.id
     WHERE oi.order_id = $1 ORDER BY i.name ASC`,
    [orderId]
  );
  return result.rows;
}

async function linkInstrumentToOrder(orderId, instrumentId) {
  await db.query(
    `INSERT INTO service_report_order_instruments (order_id, instrument_id)
     VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [orderId, instrumentId]
  );
}

async function unlinkInstrumentFromOrder(orderId, instrumentId) {
  await db.query(
    `DELETE FROM service_report_order_instruments WHERE order_id=$1 AND instrument_id=$2`,
    [orderId, instrumentId]
  );
}

async function listInstruments(serviceReportId) {
  const result = await db.query(
    `
      SELECT *
      FROM service_report_instruments
      WHERE service_report_id = $1
      ORDER BY id ASC
    `,
    [serviceReportId]
  );
  return result.rows;
}

async function createInstrument(payload) {
  const result = await db.query(
    `
      INSERT INTO service_report_instruments (
        service_report_id,
        name,
        model,
        serial_number,
        calibration_due_date,
        notes,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
      RETURNING *
    `,
    [
      payload.serviceReportId,
      payload.name,
      payload.model || "",
      payload.serialNumber || "",
      payload.calibrationDueDate,
      payload.notes || ""
    ]
  );
  return result.rows[0];
}

async function listTechnicians(serviceReportId) {
  const result = await db.query(
    `
      SELECT *
      FROM service_report_technicians
      WHERE service_report_id = $1
      ORDER BY id ASC
    `,
    [serviceReportId]
  );
  return result.rows;
}

async function createTechnician(payload) {
  const result = await db.query(
    `
      INSERT INTO service_report_technicians (
        service_report_id,
        name,
        role,
        company,
        email,
        phone,
        is_lead,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
      RETURNING *
    `,
    [
      payload.serviceReportId,
      payload.name,
      payload.role || "",
      payload.company || "",
      payload.email || "",
      payload.phone || "",
      Boolean(payload.isLead)
    ]
  );
  return result.rows[0];
}

async function updateTechnician(id, serviceReportId, payload) {
  const result = await db.query(
    `
      UPDATE service_report_technicians
      SET name = $3, role = $4, company = $5, email = $6, phone = $7, is_lead = $8, updated_at = NOW()
      WHERE id = $1 AND service_report_id = $2
      RETURNING *
    `,
    [
      id, serviceReportId,
      payload.name, payload.role || "", payload.company || "",
      payload.email || "", payload.phone || "", Boolean(payload.isLead)
    ]
  );
  return result.rows[0] || null;
}

async function deleteTechnician(id, serviceReportId) {
  const result = await db.query(
    `DELETE FROM service_report_technicians WHERE id = $1 AND service_report_id = $2`,
    [id, serviceReportId]
  );
  return result.rowCount > 0;
}

async function updateInstrument(id, serviceReportId, payload) {
  const result = await db.query(
    `
      UPDATE service_report_instruments
      SET name = $3, model = $4, serial_number = $5, calibration_due_date = $6, notes = $7, updated_at = NOW()
      WHERE id = $1 AND service_report_id = $2
      RETURNING *
    `,
    [
      id, serviceReportId,
      payload.name, payload.model || "", payload.serialNumber || "",
      payload.calibrationDueDate || null, payload.notes || ""
    ]
  );
  return result.rows[0] || null;
}

async function deleteInstrument(id, serviceReportId) {
  const result = await db.query(
    `DELETE FROM service_report_instruments WHERE id = $1 AND service_report_id = $2`,
    [id, serviceReportId]
  );
  return result.rowCount > 0;
}

async function listImages(serviceReportId) {
  const result = await db.query(
    `
      SELECT *
      FROM service_report_images
      WHERE service_report_id = $1
      ORDER BY section_key ASC, sort_order ASC, ref_id ASC, id ASC
    `,
    [serviceReportId]
  );
  return result.rows;
}

async function createImage(payload) {
  const result = await db.query(
    `
      WITH lock_report AS (
        SELECT id
        FROM service_report_reports
        WHERE id = $1
        FOR UPDATE
      ),
      next_ref AS (
        SELECT gs AS next_id
        FROM generate_series(
          1,
          COALESCE(
            (SELECT MAX(ref_id) FROM service_report_images WHERE service_report_id = $1),
            0
          ) + 1
        ) AS gs
        WHERE NOT EXISTS (
          SELECT 1
          FROM service_report_images si2
          WHERE si2.service_report_id = $1
            AND si2.ref_id = gs
        )
        ORDER BY gs
        LIMIT 1
      )
      INSERT INTO service_report_images (
        service_report_id,
        ref_id,
        section_key,
        daily_log_id,
        file_path,
        caption,
        sort_order,
        created_at,
        updated_at
      )
      VALUES ($1,(SELECT next_id FROM next_ref),$2,$3,$4,$5,$6,NOW(),NOW())
      RETURNING *
    `,
    [
      payload.serviceReportId,
      payload.sectionKey || "",
      payload.dailyLogId || null,
      payload.filePath,
      payload.caption || "",
      payload.sortOrder || 0
    ]
  );
  return result.rows[0];
}

async function updateImageCaption(imageId, caption) {
  await db.query(
    `UPDATE service_report_images SET caption = $1, updated_at = NOW() WHERE id = $2`,
    [String(caption || ""), Number(imageId)]
  );
}

async function deleteImageByRefId(serviceReportId, imageRefId) {
  const result = await db.query(
    `
      DELETE FROM service_report_images
      WHERE ref_id = $1 AND service_report_id = $2
    `,
    [imageRefId, serviceReportId]
  );
  return result.rowCount > 0;
}

async function deleteImagesBySection(serviceReportId, sectionKey) {
  await db.query(
    `
      DELETE FROM service_report_images
      WHERE service_report_id = $1 AND section_key = $2
    `,
    [serviceReportId, sectionKey]
  );
}

async function replaceSectionImages(serviceReportId, sectionKey, items = []) {
  await deleteImagesBySection(serviceReportId, sectionKey);
  const normalized = (Array.isArray(items) ? items : [])
    .filter((item) => item && item.filePath)
    .map((item, index) => ({
      filePath: String(item.filePath || "").trim(),
      caption: String(item.caption || "").trim(),
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index + 1
    }))
    .filter((item) => item.filePath);

  const created = [];
  for (const item of normalized) {
    // eslint-disable-next-line no-await-in-loop
    const row = await createImage({
      serviceReportId,
      sectionKey,
      filePath: item.filePath,
      caption: item.caption,
      sortOrder: item.sortOrder
    });
    created.push(row);
  }
  return created;
}

module.exports = {
  toInt,
  getAppSetting,
  upsertAppSetting,
  getOrderCodeSeed,
  setOrderCodeSeed,
  getOrderCodeSequence,
  listOrders,
  getOrderById,
  createOrder,
  updateOrder,
  deleteOrder,
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  listSites,
  getSiteById,
  createSite,
  updateSite,
  deleteSite,
  listEquipments,
  getEquipmentById,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  listSpareParts,
  getSparePartById,
  createSparePart,
  updateSparePart,
  deleteSparePart,
  listSparePartsByEquipment,
  listSparePartsByEquipmentIds,
  linkSparePartToEquipment,
  linkSparePartToEquipmentIfMissing,
  unlinkSparePartFromEquipment,
  updateSparePartQuantityByEquipment,
  attachEquipmentToOrder,
  listOrderEquipments,
  detachEquipmentFromOrder,
  listTimesheetByOrder,
  createTimesheetEntry,
  updateTimesheetEntry,
  deleteTimesheetEntry,
  listDailyLogsByOrder,
  getDailyLogByTagForOrder,
  createDailyLog,
  updateDailyLogByOrderAndId,
  deleteDailyLogByOrderAndId,
  listReports,
  getReportById,
  getReportByOrderId,
  createReport,
  updateReport,
  ensureDefaultSections,
  listSections,
  getSectionByKey,
  createSection,
  upsertSection,
  reorderSections,
  deleteSection,
  listComponents,
  createComponent,
  updateComponent,
  deleteComponent,
  listSignatures,
  createSignature,
  deleteSignature,
  listGlobalTechnicians,
  createGlobalTechnician,
  updateGlobalTechnician,
  deleteGlobalTechnician,
  listGlobalInstruments,
  createGlobalInstrument,
  updateGlobalInstrument,
  deleteGlobalInstrument,
  listTechniciansByOrder,
  linkTechnicianToOrder,
  unlinkTechnicianFromOrder,
  replaceTechniciansByOrder,
  listOrderTechnicianLinks,
  listInstrumentsByOrder,
  linkInstrumentToOrder,
  unlinkInstrumentFromOrder,
  listInstruments,
  createInstrument,
  updateInstrument,
  deleteInstrument,
  listTechnicians,
  createTechnician,
  updateTechnician,
  deleteTechnician,
  listImages,
  createImage,
  updateImageCaption,
  deleteImageByRefId,
  deleteImagesBySection,
  replaceSectionImages,
  createSignRequest,
  getSignRequestByToken,
  listSignRequestsByReportId,
  updateSignRequest,
  deleteSignRequest
};

