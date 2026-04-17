const db = require("./db");

const MARKER = "[seed-default-report-service]";
const DEFAULTS = {
  customer: {
    name: "Cliente Padrao Report Service",
    customerType: "others",
    notes: MARKER
  },
  site: {
    siteName: "Site Padrao Report Service",
    siteCode: "SEED-RS-SITE-0001",
    location: "Local padrao",
    notes: MARKER
  },
  equipment: {
    type: "UPS",
    yearOfManufacture: "2026",
    serialNumber: "SEED-RS-EQ-0001",
    power: "30kVA",
    ratedAcInputVoltage: "380V",
    inputFrequency: "60Hz",
    ratedDcVoltage: "240Vcc",
    ratedAcOutputVoltage: "380V",
    outputFrequency: "60Hz",
    degreeOfProtection: "IP21",
    mainLabel: "Equipamento padrao",
    dtNumber: "DT-SEED-0001",
    tagNumber: "TAG-SEED-0001",
    manufacturer: "Vextrom",
    modelFamily: "Linha Seed",
    notes: MARKER
  },
  order: {
    serviceOrderCode: "SR-DEFAULT-2026-0001",
    year: 2026,
    title: "Ordem Padrao Report Service",
    description: MARKER,
    status: "draft",
    openingDate: "2026-01-01",
    closingDate: null,
    createdBy: "seed",
    updatedBy: "seed"
  },
  report: {
    reportNumber: "REL-SR-DEFAULT-0001",
    revision: "A",
    title: "Relatorio Padrao Report Service",
    status: "draft",
    issueDate: "2026-01-01",
    templateName: "service-report-default",
    templateVersion: "1.0.0",
    preparedBy: "seed",
    reviewedBy: "",
    approvedBy: "",
    pdfPath: ""
  }
};

async function ensureCustomer() {
  const existing = await db.query(
    `
      SELECT id
      FROM service_report_customers
      WHERE name = $1
        AND notes = $2
      ORDER BY id ASC
      LIMIT 1
    `,
    [DEFAULTS.customer.name, DEFAULTS.customer.notes]
  );

  if (existing.rows[0]) {
    const id = Number(existing.rows[0].id);
    await db.query(
      `
        UPDATE service_report_customers
        SET customer_type = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [id, DEFAULTS.customer.customerType]
    );
    return { id, created: false };
  }

  const created = await db.query(
    `
      INSERT INTO service_report_customers (name, customer_type, notes, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING id
    `,
    [DEFAULTS.customer.name, DEFAULTS.customer.customerType, DEFAULTS.customer.notes]
  );
  return { id: Number(created.rows[0].id), created: true };
}

async function ensureSite(customerId) {
  const existing = await db.query(
    `
      SELECT id
      FROM service_report_customer_sites
      WHERE customer_id = $1
        AND site_code = $2
      ORDER BY id ASC
      LIMIT 1
    `,
    [customerId, DEFAULTS.site.siteCode]
  );

  if (existing.rows[0]) {
    const id = Number(existing.rows[0].id);
    await db.query(
      `
        UPDATE service_report_customer_sites
        SET site_name = $2, location = $3, notes = $4, updated_at = NOW()
        WHERE id = $1
      `,
      [id, DEFAULTS.site.siteName, DEFAULTS.site.location, DEFAULTS.site.notes]
    );
    return { id, created: false };
  }

  const created = await db.query(
    `
      INSERT INTO service_report_customer_sites (
        customer_id, site_name, site_code, location, notes, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING id
    `,
    [customerId, DEFAULTS.site.siteName, DEFAULTS.site.siteCode, DEFAULTS.site.location, DEFAULTS.site.notes]
  );
  return { id: Number(created.rows[0].id), created: true };
}

async function ensureEquipment(customerId, siteId) {
  const existing = await db.query(
    `
      SELECT id
      FROM service_report_equipments
      WHERE serial_number = $1
      ORDER BY id ASC
      LIMIT 1
    `,
    [DEFAULTS.equipment.serialNumber]
  );

  if (existing.rows[0]) {
    const id = Number(existing.rows[0].id);
    await db.query(
      `
        UPDATE service_report_equipments
        SET
          customer_id = $2,
          site_id = $3,
          type = $4,
          year_of_manufacture = $5,
          power = $6,
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
      `,
      [
        id,
        customerId,
        siteId,
        DEFAULTS.equipment.type,
        DEFAULTS.equipment.yearOfManufacture,
        DEFAULTS.equipment.power,
        DEFAULTS.equipment.ratedAcInputVoltage,
        DEFAULTS.equipment.inputFrequency,
        DEFAULTS.equipment.ratedDcVoltage,
        DEFAULTS.equipment.ratedAcOutputVoltage,
        DEFAULTS.equipment.outputFrequency,
        DEFAULTS.equipment.degreeOfProtection,
        DEFAULTS.equipment.mainLabel,
        DEFAULTS.equipment.dtNumber,
        DEFAULTS.equipment.tagNumber,
        DEFAULTS.equipment.manufacturer,
        DEFAULTS.equipment.modelFamily,
        DEFAULTS.equipment.notes
      ]
    );
    return { id, created: false };
  }

  const created = await db.query(
    `
      INSERT INTO service_report_equipments (
        customer_id, site_id, type, year_of_manufacture, serial_number,
        power, rated_ac_input_voltage, input_frequency, rated_dc_voltage, rated_ac_output_voltage,
        output_frequency, degree_of_protection, main_label, dt_number, tag_number,
        manufacturer, model_family, notes, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())
      RETURNING id
    `,
    [
      customerId,
      siteId,
      DEFAULTS.equipment.type,
      DEFAULTS.equipment.yearOfManufacture,
      DEFAULTS.equipment.serialNumber,
      DEFAULTS.equipment.power,
      DEFAULTS.equipment.ratedAcInputVoltage,
      DEFAULTS.equipment.inputFrequency,
      DEFAULTS.equipment.ratedDcVoltage,
      DEFAULTS.equipment.ratedAcOutputVoltage,
      DEFAULTS.equipment.outputFrequency,
      DEFAULTS.equipment.degreeOfProtection,
      DEFAULTS.equipment.mainLabel,
      DEFAULTS.equipment.dtNumber,
      DEFAULTS.equipment.tagNumber,
      DEFAULTS.equipment.manufacturer,
      DEFAULTS.equipment.modelFamily,
      DEFAULTS.equipment.notes
    ]
  );
  return { id: Number(created.rows[0].id), created: true };
}

async function ensureOrder(customerId, siteId) {
  const existing = await db.query(
    `
      SELECT id
      FROM service_report_orders
      WHERE service_order_code = $1
      LIMIT 1
    `,
    [DEFAULTS.order.serviceOrderCode]
  );

  if (existing.rows[0]) {
    const id = Number(existing.rows[0].id);
    await db.query(
      `
        UPDATE service_report_orders
        SET
          year = $2,
          customer_id = $3,
          site_id = $4,
          title = $5,
          description = $6,
          status = $7,
          opening_date = $8,
          closing_date = $9,
          updated_by = $10,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        id,
        DEFAULTS.order.year,
        customerId,
        siteId,
        DEFAULTS.order.title,
        DEFAULTS.order.description,
        DEFAULTS.order.status,
        DEFAULTS.order.openingDate,
        DEFAULTS.order.closingDate,
        DEFAULTS.order.updatedBy
      ]
    );
    return { id, created: false };
  }

  const created = await db.query(
    `
      INSERT INTO service_report_orders (
        service_order_code, year, customer_id, site_id, title, description, status,
        opening_date, closing_date, created_by, updated_by, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
      RETURNING id
    `,
    [
      DEFAULTS.order.serviceOrderCode,
      DEFAULTS.order.year,
      customerId,
      siteId,
      DEFAULTS.order.title,
      DEFAULTS.order.description,
      DEFAULTS.order.status,
      DEFAULTS.order.openingDate,
      DEFAULTS.order.closingDate,
      DEFAULTS.order.createdBy,
      DEFAULTS.order.updatedBy
    ]
  );
  return { id: Number(created.rows[0].id), created: true };
}

async function ensureOrderEquipment(orderId, equipmentId) {
  await db.query(
    `
      INSERT INTO service_report_order_equipments (service_order_id, equipment_id, ref_id, notes, created_at)
      VALUES (
        $1,
        $2,
        COALESCE(
          (SELECT MAX(ref_id) + 1 FROM service_report_order_equipments WHERE service_order_id = $1),
          1
        ),
        $3,
        NOW()
      )
      ON CONFLICT (service_order_id, equipment_id)
      DO UPDATE SET notes = EXCLUDED.notes
    `,
    [orderId, equipmentId, MARKER]
  );
}

async function ensureReport(orderId) {
  const existing = await db.query(
    `
      SELECT id
      FROM service_report_reports
      WHERE service_order_id = $1
      LIMIT 1
    `,
    [orderId]
  );

  if (existing.rows[0]) {
    const id = Number(existing.rows[0].id);
    await db.query(
      `
        UPDATE service_report_reports
        SET
          report_number = $2,
          revision = $3,
          title = $4,
          status = $5,
          issue_date = $6,
          template_name = $7,
          template_version = $8,
          prepared_by = $9,
          reviewed_by = $10,
          approved_by = $11,
          pdf_path = $12,
          last_modified_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        id,
        DEFAULTS.report.reportNumber,
        DEFAULTS.report.revision,
        DEFAULTS.report.title,
        DEFAULTS.report.status,
        DEFAULTS.report.issueDate,
        DEFAULTS.report.templateName,
        DEFAULTS.report.templateVersion,
        DEFAULTS.report.preparedBy,
        DEFAULTS.report.reviewedBy,
        DEFAULTS.report.approvedBy,
        DEFAULTS.report.pdfPath
      ]
    );
    return { id, created: false };
  }

  const created = await db.query(
    `
      INSERT INTO service_report_reports (
        service_order_id, report_number, revision, title, status, issue_date,
        template_name, template_version, last_modified_at, prepared_by, reviewed_by,
        approved_by, pdf_path, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10,$11,$12,NOW(),NOW())
      RETURNING id
    `,
    [
      orderId,
      DEFAULTS.report.reportNumber,
      DEFAULTS.report.revision,
      DEFAULTS.report.title,
      DEFAULTS.report.status,
      DEFAULTS.report.issueDate,
      DEFAULTS.report.templateName,
      DEFAULTS.report.templateVersion,
      DEFAULTS.report.preparedBy,
      DEFAULTS.report.reviewedBy,
      DEFAULTS.report.approvedBy,
      DEFAULTS.report.pdfPath
    ]
  );
  return { id: Number(created.rows[0].id), created: true };
}

async function ensureReportServiceDefaults() {
  const customer = await ensureCustomer();
  const site = await ensureSite(customer.id);
  const equipment = await ensureEquipment(customer.id, site.id);
  const order = await ensureOrder(customer.id, site.id);
  await ensureOrderEquipment(order.id, equipment.id);
  const report = await ensureReport(order.id);

  const createdTotal = [customer, site, equipment, order, report].filter((item) => item.created).length;
  return {
    total: createdTotal,
    customer,
    site,
    equipment,
    order,
    report
  };
}

module.exports = {
  ensureReportServiceDefaults
};
