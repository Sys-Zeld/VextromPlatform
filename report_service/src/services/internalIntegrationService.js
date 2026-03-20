const env = require("../../../specflow/config/env");

function buildInternalUrl(pathname) {
  const baseUrl = String(env.appBaseUrl || "").replace(/\/+$/, "");
  const path = String(pathname || "").startsWith("/") ? pathname : `/${pathname}`;
  return `${baseUrl}${path}`;
}

async function requestInternalJson(pathname, options = {}) {
  const response = await fetch(buildInternalUrl(pathname), {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

module.exports = {
  buildInternalUrl,
  requestInternalJson
};

