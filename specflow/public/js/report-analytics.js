(function () {
  var payload = window.reportAnalyticsData || {};
  if (typeof window.Chart === "undefined") return;

  // ── Monthly Trend ──────────────────────────────────────────────────────────
  function buildMonthlyTrend() {
    var opened = Array.isArray(payload.monthlyTrend && payload.monthlyTrend.opened)
      ? payload.monthlyTrend.opened
      : [];
    var closed = Array.isArray(payload.monthlyTrend && payload.monthlyTrend.closed)
      ? payload.monthlyTrend.closed
      : [];
    var keys = {};
    opened.forEach(function (item) { keys[item.month_ref] = true; });
    closed.forEach(function (item) { keys[item.month_ref] = true; });
    var labels = Object.keys(keys).sort();
    var openedMap = {};
    var closedMap = {};
    opened.forEach(function (item) { openedMap[item.month_ref] = Number(item.qty || 0); });
    closed.forEach(function (item) { closedMap[item.month_ref] = Number(item.qty || 0); });
    return {
      labels: labels,
      opened: labels.map(function (l) { return openedMap[l] || 0; }),
      closed: labels.map(function (l) { return closedMap[l] || 0; })
    };
  }

  var trendData = buildMonthlyTrend();
  var trendCanvas = document.getElementById("monthlyTrendChart");
  if (trendCanvas) {
    new window.Chart(trendCanvas, {
      type: "line",
      data: {
        labels: trendData.labels,
        datasets: [
          { label: "OS Abertas", data: trendData.opened, borderColor: "#256d3a", backgroundColor: "rgba(37,109,58,0.16)", tension: 0.25, fill: true },
          { label: "OS Finalizadas", data: trendData.closed, borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,0.12)", tension: 0.25, fill: true }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 120,
        plugins: { legend: { position: "bottom" } }
      }
    });
  }

  // ── Signature Status ───────────────────────────────────────────────────────
  var signatureRows = Array.isArray(payload.tables && payload.tables.signatureStatus)
    ? payload.tables.signatureStatus
    : [];
  var signatureCanvas = document.getElementById("signatureStatusChart");
  if (signatureCanvas) {
    new window.Chart(signatureCanvas, {
      type: "doughnut",
      data: {
        labels: signatureRows.map(function (r) { return r.status; }),
        datasets: [{
          data: signatureRows.map(function (r) { return Number(r.qty || 0); }),
          backgroundColor: ["#16a34a", "#f59e0b", "#ef4444", "#64748b"]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 120,
        plugins: { legend: { position: "bottom" } }
      }
    });
  }

  // ── OS by Status ───────────────────────────────────────────────────────────
  var statusRows = Array.isArray(payload.tables && payload.tables.ordersByStatus)
    ? payload.tables.ordersByStatus
    : [];
  var statusCanvas = document.getElementById("statusChart");
  if (statusCanvas && statusRows.length) {
    var statusColors = {
      draft: "#94a3b8",
      valid: "#3b82f6",
      in_progress: "#f59e0b",
      waiting_review: "#f97316",
      approved: "#22c55e",
      issued: "#16a34a",
      closed: "#64748b",
      cancelled: "#ef4444"
    };
    new window.Chart(statusCanvas, {
      type: "bar",
      data: {
        labels: statusRows.map(function (r) { return r.status; }),
        datasets: [{
          label: "OS por Status",
          data: statusRows.map(function (r) { return Number(r.qty || 0); }),
          backgroundColor: statusRows.map(function (r) { return statusColors[r.status] || "#64748b"; }),
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 120,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }

  // ── Backlog Aging ──────────────────────────────────────────────────────────
  var backlogRows = Array.isArray(payload.tables && payload.tables.backlogAging)
    ? payload.tables.backlogAging
    : [];
  var backlogCanvas = document.getElementById("backlogChart");
  if (backlogCanvas && backlogRows.length) {
    var backlogColors = ["#22c55e", "#f59e0b", "#f97316", "#ef4444", "#94a3b8"];
    new window.Chart(backlogCanvas, {
      type: "bar",
      data: {
        labels: backlogRows.map(function (r) { return r.aging_bucket; }),
        datasets: [{
          label: "OS em Backlog",
          data: backlogRows.map(function (r) { return Number(r.qty || 0); }),
          backgroundColor: backlogRows.map(function (r, i) { return backlogColors[i % backlogColors.length]; }),
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 120,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }

  // ── Hours by Technician ────────────────────────────────────────────────────
  var hoursRows = Array.isArray(payload.tables && payload.tables.hoursByTechnician)
    ? payload.tables.hoursByTechnician.slice(0, 15)
    : [];
  var hoursCanvas = document.getElementById("hoursChart");
  if (hoursCanvas && hoursRows.length) {
    new window.Chart(hoursCanvas, {
      type: "bar",
      data: {
        labels: hoursRows.map(function (r) { return r.technician_name; }),
        datasets: [{
          label: "Horas",
          data: hoursRows.map(function (r) { return Number(r.total_hours || 0); }),
          backgroundColor: "rgba(37,109,58,0.75)",
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 120,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true }
        }
      }
    });
  }

  // ── Top Customers ──────────────────────────────────────────────────────────
  var customerRows = Array.isArray(payload.tables && payload.tables.topCustomers)
    ? payload.tables.topCustomers.slice(0, 10)
    : [];
  var customerCanvas = document.getElementById("customerChart");
  if (customerCanvas && customerRows.length) {
    new window.Chart(customerCanvas, {
      type: "bar",
      data: {
        labels: customerRows.map(function (r) { return r.name; }),
        datasets: [{
          label: "OS",
          data: customerRows.map(function (r) { return Number(r.os_qty || 0); }),
          backgroundColor: "rgba(59,130,246,0.75)",
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 120,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }
})();
