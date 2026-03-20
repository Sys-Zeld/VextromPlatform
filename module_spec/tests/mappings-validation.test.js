const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

function loadServiceWithMocks(mocks) {
  const servicePath = path.join(process.cwd(), "module_spec", "src", "services", "simpleFilterService.js");
  const repoPath = path.join(process.cwd(), "module_spec", "src", "repositories", "simpleRepository.js");
  const integrationPath = path.join(process.cwd(), "module_spec", "src", "services", "specIntegrationService.js");
  const profilesPath = path.join(process.cwd(), "src", "services", "profiles.js");
  const fieldsPath = path.join(process.cwd(), "src", "services", "fields.js");

  [servicePath, repoPath, integrationPath, profilesPath, fieldsPath].forEach((item) => {
    delete require.cache[item];
  });
  require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: mocks.repository || {} };
  require.cache[integrationPath] = { id: integrationPath, filename: integrationPath, loaded: true, exports: mocks.integration || {} };
  require.cache[profilesPath] = { id: profilesPath, filename: profilesPath, loaded: true, exports: mocks.profiles };
  require.cache[fieldsPath] = { id: fieldsPath, filename: fieldsPath, loaded: true, exports: mocks.fields };

  return require(servicePath);
}

test("rejects duplicated mapping", async () => {
  const service = loadServiceWithMocks({
    repository: { getAttributeDefinitionByKey: async () => ({ id: 1, key: "power_kva" }) },
    profiles: { getProfileById: async () => ({ id: 1 }) },
    fields: { getFieldById: async () => ({ id: 10 }) }
  });

  await assert.rejects(
    () => service.validateMappingsPayload(1, [
      { fieldId: 10, equipmentAttributeKey: "power_kva", operator: "equals" },
      { fieldId: 10, equipmentAttributeKey: "power_kva", operator: "equals" }
    ]),
    /Mapping duplicado/
  );
});

test("rejects invalid operator", async () => {
  const service = loadServiceWithMocks({
    repository: { getAttributeDefinitionByKey: async () => ({ id: 1, key: "power_kva" }) },
    profiles: { getProfileById: async () => ({ id: 1 }) },
    fields: { getFieldById: async () => ({ id: 10 }) }
  });

  await assert.rejects(
    () => service.validateMappingsPayload(1, [
      { fieldId: 10, equipmentAttributeKey: "power_kva", operator: "invalid_operator" }
    ]),
    /operator invalido/
  );
});

test("rejects mapping when attribute definition does not exist", async () => {
  const service = loadServiceWithMocks({
    repository: { getAttributeDefinitionByKey: async () => null },
    profiles: { getProfileById: async () => ({ id: 1 }) },
    fields: { getFieldById: async () => ({ id: 10 }) }
  });

  await assert.rejects(
    () => service.validateMappingsPayload(1, [
      { fieldId: 10, equipmentAttributeKey: "unknown_attr", operator: "equals" }
    ]),
    /nao encontrado/
  );
});
