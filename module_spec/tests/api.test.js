const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const path = require("path");
const express = require("express");

function loadRouterWithFakeController(fakeController) {
  const controllerPath = path.join(process.cwd(), "module_spec", "src", "controllers", "createModuleSpecController.js");
  const routerPath = path.join(process.cwd(), "module_spec", "src", "routes", "index.js");
  delete require.cache[controllerPath];
  delete require.cache[routerPath];
  require.cache[controllerPath] = {
    id: controllerPath,
    filename: controllerPath,
    loaded: true,
    exports: {
      createModuleSpecController: () => fakeController
    }
  };
  return require(routerPath).createModuleSpecRouter;
}

async function withServer(app, callback) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test("exposes simplified endpoints under /api/module-spec", async () => {
  const fakeController = {
    listFamilies: async (_req, res) => res.json({ data: [{ id: 1 }] }),
    createFamily: async (_req, res) => res.status(201).json({ data: { id: 2 } }),
    getFamily: async (_req, res) => res.json({ data: { id: 1 } }),
    updateFamily: async (_req, res) => res.json({ data: { id: 1 } }),
    deleteFamily: async (_req, res) => res.json({ data: { deleted: true } }),
    listModels: async (_req, res) => res.json({ data: [] }),
    createModel: async (_req, res) => res.status(201).json({ data: {} }),
    getModel: async (_req, res) => res.json({ data: {} }),
    updateModel: async (_req, res) => res.json({ data: {} }),
    deleteModel: async (_req, res) => res.json({ data: { deleted: true } }),
    listVariantsByModel: async (_req, res) => res.json({ data: [] }),
    createVariantForModel: async (_req, res) => res.status(201).json({ data: {} }),
    getVariant: async (_req, res) => res.json({ data: {} }),
    updateVariant: async (_req, res) => res.json({ data: {} }),
    deleteVariant: async (_req, res) => res.json({ data: { deleted: true } }),
    listAttributeDefinitions: async (_req, res) => res.json({ data: [] }),
    createAttributeDefinition: async (_req, res) => res.status(201).json({ data: {} }),
    getAttributeDefinition: async (_req, res) => res.json({ data: {} }),
    updateAttributeDefinition: async (_req, res) => res.json({ data: {} }),
    deleteAttributeDefinition: async (_req, res) => res.json({ data: { deleted: true } }),
    listVariantAttributes: async (_req, res) => res.json({ data: [] }),
    replaceVariantAttributes: async (_req, res) => res.json({ data: [] }),
    listProfileFilterMappings: async (_req, res) => res.json({ data: [] }),
    replaceProfileFilterMappings: async (_req, res) => res.json({ data: [] }),
    runFilterByProfile: async (_req, res) => res.json({ data: { totalMatches: 1, matches: [{ variantId: 10 }] } }),
    runFilterByEquipment: async (_req, res) => res.json({ data: { totalMatches: 0, matches: [] } })
  };

  const createRouter = loadRouterWithFakeController(fakeController);
  const app = express();
  app.use(express.json());
  app.use("/api/module-spec", createRouter({
    asyncHandler: (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next),
    requireApiScope: () => (_req, _res, next) => next()
  }));

  await withServer(app, async (baseUrl) => {
    const familiesResponse = await fetch(`${baseUrl}/api/module-spec/families`);
    const filterResponse = await fetch(`${baseUrl}/api/module-spec/profiles/1/filter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ required: { power_kva: 100 } })
    });

    assert.equal(familiesResponse.status, 200);
    assert.equal(filterResponse.status, 200);
    assert.equal((await filterResponse.json()).data.totalMatches, 1);
  });
});
