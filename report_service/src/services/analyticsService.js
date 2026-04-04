const baseRepo = require("../repositories/serviceReportRepository");
const analyticsRepo = require("../repositories/analyticsRepository");

function normalizeDashboardFilters(input = {}) {
  return analyticsRepo.normalizeFilters({
    dateFrom: input.date_from || input.dateFrom,
    dateTo: input.date_to || input.dateTo,
    customerId: input.customer_id || input.customerId,
    siteId: input.site_id || input.siteId,
    technicianId: input.technician_id || input.technicianId,
    orderStatus: input.order_status || input.orderStatus
  });
}

async function getDashboardPayload(inputFilters = {}) {
  const filters = normalizeDashboardFilters(inputFilters);
  const [
    customers,
    sites,
    technicians,
    kpis,
    ordersByStatus,
    ordersByTechnician,
    hoursByOrder,
    hoursByTechnician,
    topSpareParts,
    topCustomers,
    topSites,
    signatureStatus,
    revisionDistribution,
    monthlyTrend,
    backlogAging,
    dataQuality,
    equipmentStats
  ] = await Promise.all([
    baseRepo.listCustomers(),
    baseRepo.listSites(),
    baseRepo.listGlobalTechnicians(),
    analyticsRepo.getKpis(filters),
    analyticsRepo.getOrdersByStatus(filters),
    analyticsRepo.getOrdersByTechnician(filters),
    analyticsRepo.getHoursByOrder(filters),
    analyticsRepo.getHoursByTechnician(filters),
    analyticsRepo.getTopSpareParts(filters),
    analyticsRepo.getTopCustomers(filters),
    analyticsRepo.getTopSites(filters),
    analyticsRepo.getSignatureStatus(filters),
    analyticsRepo.getRevisionDistribution(filters),
    analyticsRepo.getMonthlyTrend(filters),
    analyticsRepo.getBacklogAging(filters),
    analyticsRepo.getDataQuality(filters),
    analyticsRepo.getEquipmentStats(filters)
  ]);

  return {
    filters,
    options: {
      customers,
      sites,
      technicians,
      statuses: ["draft", "valid", "approved"]
    },
    kpis,
    tables: {
      ordersByStatus,
      ordersByTechnician,
      hoursByOrder,
      hoursByTechnician,
      topSpareParts,
      topCustomers,
      topSites,
      signatureStatus,
      revisionDistribution,
      backlogAging
    },
    monthlyTrend,
    dataQuality,
    equipmentStats
  };
}

module.exports = {
  normalizeDashboardFilters,
  getDashboardPayload
};
