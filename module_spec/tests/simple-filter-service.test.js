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
  require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: mocks.repository };
  require.cache[integrationPath] = { id: integrationPath, filename: integrationPath, loaded: true, exports: mocks.integration };
  require.cache[profilesPath] = { id: profilesPath, filename: profilesPath, loaded: true, exports: mocks.profiles };
  require.cache[fieldsPath] = { id: fieldsPath, filename: fieldsPath, loaded: true, exports: mocks.fields };

  return require(servicePath);
}

const baseMappings = [
  {
    fieldId: 1,
    fieldKey: "power_kva",
    equipmentAttributeKey: "power_kva",
    operator: "equals",
    filterActive: true,
    requiredMatch: true
  },
  {
    fieldId: 2,
    fieldKey: "output_voltage",
    equipmentAttributeKey: "output_voltage",
    operator: "equals",
    filterActive: true,
    requiredMatch: true
  }
];

const baseVariants = [
  {
    id: 11,
    equipmentModelId: 1,
    manufacturer: "Vextrom",
    brand: "Vextrom",
    model: "CP60",
    sku: "CP60",
    variantName: "60kVA",
    variantCode: "CP60-60",
    attributes: [
      { attributeKey: "power_kva", valueType: "number", valueNumber: 60 },
      { attributeKey: "output_voltage", valueType: "number", valueNumber: 380 }
    ]
  },
  {
    id: 12,
    equipmentModelId: 1,
    manufacturer: "Vextrom",
    brand: "Vextrom",
    model: "CP60",
    sku: "CP60",
    variantName: "100kVA",
    variantCode: "CP60-100",
    attributes: [
      { attributeKey: "power_kva", valueType: "number", valueNumber: 100 },
      { attributeKey: "output_voltage", valueType: "number", valueNumber: 380 }
    ]
  }
];

function createService() {
  return loadServiceWithMocks({
    repository: {
      listProfileFilterMappings: async () => baseMappings,
      listVariantsWithContext: async () => baseVariants
    },
    integration: {
      resolveSelectionContext: async (payload) => ({
        profileId: payload.profileId || 1,
        sourceEquipmentId: payload.equipmentId || null,
        resolvedRequired: payload.required || {}
      })
    },
    profiles: {
      getProfileById: async () => ({ id: 1, name: "Perfil A" })
    },
    fields: {
      getFieldById: async (id) => ({ id, key: `field_${id}` })
    }
  });
}

test("returns match for direct equals", async () => {
  const service = createService();
  const result = await service.executeSimpleFilter({
    profileId: 1,
    required: { power_kva: 100, output_voltage: 380 }
  });
  assert.equal(result.totalMatches, 1);
  assert.equal(result.matches[0].variantId, 12);
});

test("returns no match when required does not match", async () => {
  const service = createService();
  const result = await service.executeSimpleFilter({
    profileId: 1,
    required: { power_kva: 200, output_voltage: 380 }
  });
  assert.equal(result.totalMatches, 0);
});

test("ignores empty required field", async () => {
  const service = createService();
  const result = await service.executeSimpleFilter({
    profileId: 1,
    required: { power_kva: "", output_voltage: 380 }
  });
  assert.equal(result.ignoredFilters.length, 1);
  assert.equal(result.appliedFilters.length, 1);
});

test("normalizes numeric comparison with comma", async () => {
  const service = loadServiceWithMocks({
    repository: {
      listProfileFilterMappings: async () => ([
        {
          fieldId: 1,
          fieldKey: "power_kva",
          equipmentAttributeKey: "power_kva",
          operator: "gte",
          filterActive: true,
          requiredMatch: true
        }
      ]),
      listVariantsWithContext: async () => ([
        {
          id: 20,
          equipmentModelId: 1,
          manufacturer: "A",
          brand: "B",
          model: "M",
          sku: "S",
          variantName: "v",
          variantCode: "v",
          attributes: [{ attributeKey: "power_kva", valueType: "text", valueText: "100,0 kVA" }]
        }
      ])
    },
    integration: {
      resolveSelectionContext: async () => ({
        profileId: 1,
        sourceEquipmentId: null,
        resolvedRequired: { power_kva: "99.5" }
      })
    },
    profiles: {
      getProfileById: async () => ({ id: 1, name: "Perfil A" })
    },
    fields: {
      getFieldById: async (id) => ({ id, key: `field_${id}` })
    }
  });

  const result = await service.executeSimpleFilter({ profileId: 1, required: {} });
  assert.equal(result.totalMatches, 1);
});

test("normalizes text comparison case-insensitive", async () => {
  const service = loadServiceWithMocks({
    repository: {
      listProfileFilterMappings: async () => ([
        {
          fieldId: 1,
          fieldKey: "topology",
          equipmentAttributeKey: "topology",
          operator: "equals",
          filterActive: true,
          requiredMatch: true
        }
      ]),
      listVariantsWithContext: async () => ([
        {
          id: 99,
          equipmentModelId: 1,
          manufacturer: "A",
          brand: "B",
          model: "M",
          sku: "S",
          variantName: "v",
          variantCode: "v",
          attributes: [{ attributeKey: "topology", valueType: "text", valueText: "ONLINE" }]
        }
      ])
    },
    integration: {
      resolveSelectionContext: async () => ({
        profileId: 1,
        sourceEquipmentId: null,
        resolvedRequired: { topology: "online" }
      })
    },
    profiles: {
      getProfileById: async () => ({ id: 1, name: "Perfil A" })
    },
    fields: {
      getFieldById: async (id) => ({ id, key: `field_${id}` })
    }
  });

  const result = await service.executeSimpleFilter({ profileId: 1, required: {} });
  assert.equal(result.totalMatches, 1);
});
