const db = require("../../db");
const { SECTION_DEFINITIONS, SECTION_SEED_HTML } = require("../constants");
const EMPTY_DELTA = { ops: [{ insert: "\n" }] };

function toInt(value) {
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
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
  const result = await db.query(
    `
      SELECT COUNT(*)::int AS total
      FROM service_report_orders
      WHERE year = $1
    `,
    [year]
  );
  return Number(result.rows[0]?.total || 0) + 1;
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
        notes,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
      RETURNING *
    `,
    [
      payload.customerId,
      payload.siteName,
      payload.siteCode || "",
      payload.location || "",
      payload.notes || ""
    ]
  );
  return result.rows[0];
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
        e.tag_number
      FROM service_report_order_equipments oe
      INNER JOIN service_report_equipments e ON e.id = oe.equipment_id
      WHERE oe.service_order_id = $1
      ORDER BY oe.ref_id ASC, oe.id ASC
    `,
    [serviceOrderId]
  );
  return result.rows;
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
      SELECT *
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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10,$11,$12,NOW(),NOW())
      RETURNING *
    `,
    [
      payload.serviceOrderId,
      payload.reportNumber,
      payload.revision || "A",
      payload.title,
      payload.status || "draft",
      payload.issueDate,
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
        template_name = $6,
        template_version = $7,
        prepared_by = $8,
        reviewed_by = $9,
        approved_by = $10,
        pdf_path = $11,
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
  const defaultSections = SECTION_DEFINITIONS.filter((section) => section.key === "scope");
  for (const section of defaultSections) {
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
        EMPTY_DELTA,
        "<p><br></p>",
        "",
        "",
        "",
        section.sortOrder
      ]
    );

    // Backward compatibility: clear old seeded default content if it was never edited.
    // This keeps preview strictly aligned with what was typed in rich text.
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
            content_html = $6
            OR content_text = $7
          )
      `,
      [
        serviceReportId,
        section.key,
        EMPTY_DELTA,
        "<p><br></p>",
        "",
        String(SECTION_SEED_HTML[section.key] || ""),
        stripHtmlToText(SECTION_SEED_HTML[section.key] || "")
      ]
    );
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
  listSites,
  getSiteById,
  createSite,
  listEquipments,
  getEquipmentById,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  attachEquipmentToOrder,
  listOrderEquipments,
  listTimesheetByOrder,
  createTimesheetEntry,
  updateTimesheetEntry,
  deleteTimesheetEntry,
  listDailyLogsByOrder,
  createDailyLog,
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
  deleteSection,
  listComponents,
  createComponent,
  updateComponent,
  deleteComponent,
  listSignatures,
  createSignature,
  listInstruments,
  createInstrument,
  listTechnicians,
  createTechnician,
  listImages,
  createImage,
  deleteImageByRefId,
  deleteImagesBySection,
  replaceSectionImages
};
