const db = require("../../db");

function normalizeFilters(input = {}) {
  const toDate = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  };
  const toInt = (value) => {
    const num = Number(value);
    return Number.isInteger(num) && num > 0 ? num : null;
  };
  const allStatuses = ["draft", "valid", "in_progress", "waiting_review", "approved", "issued", "closed", "cancelled"];
  const statusRaw = String(input.orderStatus || "").trim().toLowerCase();
  const orderStatus = statusRaw && allStatuses.includes(statusRaw) ? statusRaw : null;

  return {
    dateFrom: toDate(input.dateFrom),
    dateTo: toDate(input.dateTo),
    customerId: toInt(input.customerId),
    siteId: toInt(input.siteId),
    technicianId: toInt(input.technicianId),
    orderStatus
  };
}

function filterParams(filters) {
  return [
    filters.dateFrom,
    filters.dateTo,
    filters.customerId,
    filters.siteId,
    filters.technicianId,
    filters.orderStatus
  ];
}

// Calculates worked hours from check_in_client/check_out_client text columns (HH:MM).
// Falls back to the stored worked_hours column when time fields are invalid.
function workedHoursSql(alias = "t") {
  return `
    CASE
      WHEN ${alias}.check_in_client ~ '^[0-9]{1,2}:[0-9]{2}$'
       AND ${alias}.check_out_client ~ '^[0-9]{1,2}:[0-9]{2}$'
       AND ${alias}.check_out_client::time > ${alias}.check_in_client::time
      THEN EXTRACT(EPOCH FROM (${alias}.check_out_client::time - ${alias}.check_in_client::time)) / 3600.0
      ELSE COALESCE(${alias}.worked_hours, 0)
    END
  `;
}

function orderFilterSql(alias = "o") {
  return `
    ($1::date IS NULL OR ${alias}.opening_date >= $1)
    AND ($2::date IS NULL OR ${alias}.opening_date <= $2)
    AND ($3::bigint IS NULL OR ${alias}.customer_id = $3)
    AND ($4::bigint IS NULL OR ${alias}.site_id = $4)
    AND (
      $5::bigint IS NULL
      OR EXISTS (
        SELECT 1
        FROM service_report_order_technicians otf
        WHERE otf.order_id = ${alias}.id
          AND otf.technician_id = $5
      )
    )
    AND ($6::text IS NULL OR ${alias}.status = $6)
  `;
}

async function getKpis(filters) {
  const params = filterParams(filters);
  const result = await db.query(
    `
      SELECT
        COUNT(*)::int AS total_os,
        COUNT(*) FILTER (WHERE o.status = 'draft')::int AS total_draft,
        COUNT(*) FILTER (WHERE o.status = 'valid')::int AS total_valid,
        COUNT(*) FILTER (WHERE o.status = 'in_progress')::int AS total_in_progress,
        COUNT(*) FILTER (WHERE o.status = 'waiting_review')::int AS total_waiting_review,
        COUNT(*) FILTER (WHERE o.status = 'approved')::int AS total_approved,
        COUNT(*) FILTER (WHERE o.status = 'issued')::int AS total_issued,
        COUNT(*) FILTER (WHERE o.status = 'closed')::int AS total_closed,
        COUNT(*) FILTER (WHERE o.status = 'cancelled')::int AS total_cancelled,
        COALESCE(AVG(
          CASE
            WHEN o.closing_date IS NOT NULL AND o.opening_date IS NOT NULL THEN (o.closing_date - o.opening_date)
            ELSE NULL
          END
        ), 0)::numeric(10,2) AS avg_close_days
      FROM service_report_orders o
      WHERE ${orderFilterSql("o")}
    `,
    params
  );

  const hoursResult = await db.query(
    `
      SELECT COALESCE(SUM(${workedHoursSql("t")}), 0)::numeric(12,2) AS total_hours
      FROM service_report_timesheet_entries t
      INNER JOIN service_report_orders o ON o.id = t.service_order_id
      WHERE ${orderFilterSql("o")}
    `,
    params
  );

  const signaturesResult = await db.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE sr.status = 'signed')::int AS signed_count,
        COUNT(*) FILTER (WHERE sr.status = 'pending')::int AS pending_count,
        COUNT(*) FILTER (WHERE sr.status = 'cancelled')::int AS cancelled_count
      FROM service_report_sign_requests sr
      INNER JOIN service_report_reports r ON r.id = sr.service_report_id
      INNER JOIN service_report_orders o ON o.id = r.service_order_id
      WHERE ${orderFilterSql("o")}
    `,
    params
  );

  return {
    ...(result.rows[0] || {}),
    total_hours: Number(hoursResult.rows[0]?.total_hours || 0),
    ...(signaturesResult.rows[0] || {})
  };
}

async function getOrdersByStatus(filters) {
  const result = await db.query(
    `
      SELECT o.status, COUNT(*)::int AS qty
      FROM service_report_orders o
      WHERE ${orderFilterSql("o")}
      GROUP BY o.status
      ORDER BY qty DESC, o.status ASC
    `,
    filterParams(filters)
  );
  return result.rows;
}

async function getOrdersByTechnician(filters) {
  const result = await db.query(
    `
      SELECT
        t.id AS technician_id,
        t.name,
        COUNT(DISTINCT ot.order_id)::int AS os_qty
      FROM service_report_global_technicians t
      LEFT JOIN service_report_order_technicians ot ON ot.technician_id = t.id
      LEFT JOIN service_report_orders o ON o.id = ot.order_id
      WHERE (${orderFilterSql("o")}) OR o.id IS NULL
      GROUP BY t.id, t.name
      HAVING COUNT(DISTINCT ot.order_id) > 0
      ORDER BY os_qty DESC, t.name ASC
    `,
    filterParams(filters)
  );
  return result.rows;
}

async function getHoursByOrder(filters) {
  const result = await db.query(
    `
      SELECT
        o.id AS order_id,
        o.service_order_code,
        o.title,
        COALESCE(SUM(${workedHoursSql("t")}), 0)::numeric(12,2) AS total_hours
      FROM service_report_orders o
      LEFT JOIN service_report_timesheet_entries t ON t.service_order_id = o.id
      WHERE ${orderFilterSql("o")}
      GROUP BY o.id, o.service_order_code, o.title
      ORDER BY total_hours DESC, o.id DESC
      LIMIT 50
    `,
    filterParams(filters)
  );
  return result.rows;
}

async function getHoursByTechnician(filters) {
  const result = await db.query(
    `
      SELECT
        COALESCE(NULLIF(TRIM(t.technician_name), ''), '(sem tecnico)') AS technician_name,
        COALESCE(SUM(${workedHoursSql("t")}), 0)::numeric(12,2) AS total_hours
      FROM service_report_timesheet_entries t
      INNER JOIN service_report_orders o ON o.id = t.service_order_id
      WHERE ${orderFilterSql("o")}
      GROUP BY COALESCE(NULLIF(TRIM(t.technician_name), ''), '(sem tecnico)')
      ORDER BY total_hours DESC, technician_name ASC
      LIMIT 50
    `,
    filterParams(filters)
  );
  return result.rows;
}

async function getTopSpareParts(filters) {
  const result = await db.query(
    `
      SELECT
        sp.id,
        sp.part_number,
        sp.description,
        COALESCE(SUM(es.quantity), 0)::int AS qty_used
      FROM service_report_spare_parts sp
      INNER JOIN service_report_equipment_spare_parts es ON es.spare_part_id = sp.id
      INNER JOIN service_report_equipments e ON e.id = es.equipment_id
      INNER JOIN service_report_order_equipments oe ON oe.equipment_id = e.id
      INNER JOIN service_report_orders o ON o.id = oe.service_order_id
      WHERE ${orderFilterSql("o")}
      GROUP BY sp.id, sp.part_number, sp.description
      ORDER BY qty_used DESC, sp.description ASC
      LIMIT 50
    `,
    filterParams(filters)
  );
  return result.rows;
}

async function getTopCustomers(filters) {
  const result = await db.query(
    `
      SELECT c.id, c.name, COUNT(*)::int AS os_qty
      FROM service_report_orders o
      INNER JOIN service_report_customers c ON c.id = o.customer_id
      WHERE ${orderFilterSql("o")}
      GROUP BY c.id, c.name
      ORDER BY os_qty DESC, c.name ASC
      LIMIT 20
    `,
    filterParams(filters)
  );
  return result.rows;
}

async function getTopSites(filters) {
  const result = await db.query(
    `
      SELECT s.id, s.site_name, COUNT(*)::int AS os_qty
      FROM service_report_orders o
      INNER JOIN service_report_customer_sites s ON s.id = o.site_id
      WHERE ${orderFilterSql("o")}
      GROUP BY s.id, s.site_name
      ORDER BY os_qty DESC, s.site_name ASC
      LIMIT 20
    `,
    filterParams(filters)
  );
  return result.rows;
}

async function getSignatureStatus(filters) {
  const result = await db.query(
    `
      SELECT sr.status, COUNT(*)::int AS qty
      FROM service_report_sign_requests sr
      INNER JOIN service_report_reports r ON r.id = sr.service_report_id
      INNER JOIN service_report_orders o ON o.id = r.service_order_id
      WHERE ${orderFilterSql("o")}
      GROUP BY sr.status
      ORDER BY qty DESC, sr.status ASC
    `,
    filterParams(filters)
  );
  return result.rows;
}

async function getRevisionDistribution(filters) {
  const result = await db.query(
    `
      SELECT COALESCE(NULLIF(TRIM(r.revision), ''), 'A') AS revision, COUNT(*)::int AS qty
      FROM service_report_reports r
      INNER JOIN service_report_orders o ON o.id = r.service_order_id
      WHERE ${orderFilterSql("o")}
      GROUP BY COALESCE(NULLIF(TRIM(r.revision), ''), 'A')
      ORDER BY revision ASC
    `,
    filterParams(filters)
  );
  return result.rows;
}

async function getMonthlyTrend(filters) {
  const opened = await db.query(
    `
      SELECT to_char(date_trunc('month', o.opening_date), 'YYYY-MM') AS month_ref, COUNT(*)::int AS qty
      FROM service_report_orders o
      WHERE o.opening_date IS NOT NULL
        AND ${orderFilterSql("o")}
      GROUP BY date_trunc('month', o.opening_date)
      ORDER BY month_ref ASC
    `,
    filterParams(filters)
  );

  const closed = await db.query(
    `
      SELECT to_char(date_trunc('month', o.closing_date), 'YYYY-MM') AS month_ref, COUNT(*)::int AS qty
      FROM service_report_orders o
      WHERE o.closing_date IS NOT NULL
        AND ${orderFilterSql("o")}
      GROUP BY date_trunc('month', o.closing_date)
      ORDER BY month_ref ASC
    `,
    filterParams(filters)
  );

  return {
    opened: opened.rows,
    closed: closed.rows
  };
}

async function getBacklogAging(filters) {
  const result = await db.query(
    `
      SELECT
        CASE
          WHEN o.opening_date IS NULL THEN 'Sem data'
          WHEN (CURRENT_DATE - o.opening_date) <= 7 THEN '0-7 dias'
          WHEN (CURRENT_DATE - o.opening_date) <= 15 THEN '8-15 dias'
          WHEN (CURRENT_DATE - o.opening_date) <= 30 THEN '16-30 dias'
          ELSE '31+ dias'
        END AS aging_bucket,
        COUNT(*)::int AS qty
      FROM service_report_orders o
      WHERE ${orderFilterSql("o")}
        AND o.status <> 'approved'
      GROUP BY 1
      ORDER BY qty DESC
    `,
    filterParams(filters)
  );
  return result.rows;
}

async function getDataQuality(filters) {
  const result = await db.query(
    `
      SELECT
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM service_report_timesheet_entries t WHERE t.service_order_id = o.id
          )
        )::int AS missing_timesheet,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1
            FROM service_report_daily_logs d
            WHERE d.service_order_id = o.id
              AND TRIM(COALESCE(d.notes, '')) <> 'conclusaogeral'
          )
        )::int AS missing_daily_description,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1
            FROM service_report_daily_logs d
            WHERE d.service_order_id = o.id
              AND TRIM(COALESCE(d.notes, '')) = 'conclusaogeral'
          )
        )::int AS missing_conclusion,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1
            FROM service_report_reports r
            JOIN service_report_sign_requests sr ON sr.service_report_id = r.id AND sr.status = 'signed'
            WHERE r.service_order_id = o.id
          )
        )::int AS missing_signature
      FROM service_report_orders o
      WHERE ${orderFilterSql("o")}
    `,
    filterParams(filters)
  );
  return result.rows[0] || {
    total_orders: 0,
    missing_timesheet: 0,
    missing_daily_description: 0,
    missing_conclusion: 0,
    missing_signature: 0
  };
}

async function getEquipmentStats(filters) {
  const result = await db.query(
    `
      SELECT
        COUNT(DISTINCT oe.equipment_id)::int AS total_equipments,
        COUNT(DISTINCT e.model_family)::int AS total_families
      FROM service_report_order_equipments oe
      INNER JOIN service_report_equipments e ON e.id = oe.equipment_id
      INNER JOIN service_report_orders o ON o.id = oe.service_order_id
      WHERE ${orderFilterSql("o")}
    `,
    filterParams(filters)
  );

  const byFamily = await db.query(
    `
      SELECT
        COALESCE(NULLIF(TRIM(e.model_family), ''), '(sem familia)') AS model_family,
        COUNT(DISTINCT oe.equipment_id)::int AS qty
      FROM service_report_order_equipments oe
      INNER JOIN service_report_equipments e ON e.id = oe.equipment_id
      INNER JOIN service_report_orders o ON o.id = oe.service_order_id
      WHERE ${orderFilterSql("o")}
      GROUP BY 1
      ORDER BY qty DESC, model_family ASC
      LIMIT 15
    `,
    filterParams(filters)
  );

  return {
    total_equipments: result.rows[0]?.total_equipments || 0,
    total_families: result.rows[0]?.total_families || 0,
    byFamily: byFamily.rows
  };
}

module.exports = {
  normalizeFilters,
  getKpis,
  getOrdersByStatus,
  getOrdersByTechnician,
  getHoursByOrder,
  getHoursByTechnician,
  getTopSpareParts,
  getTopCustomers,
  getTopSites,
  getSignatureStatus,
  getRevisionDistribution,
  getMonthlyTrend,
  getBacklogAging,
  getDataQuality,
  getEquipmentStats
};
