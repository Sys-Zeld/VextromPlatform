const db = require("../specflow/db");
const {
  listProfiles,
  deleteProfile,
  createProfile,
  clearAllFieldsFromProfile,
  createFieldInProfile
} = require("../specflow/services/profiles");

const PROFILE_NAME = "PADRÃO CHLORIDE";

const FIELD_DEFINITIONS = [
  // Dados Gerais
  { section: "Dados Gerais", key: "potencia_nominal_requerida_kva", label: "Potencia nominal requerida (kVA)", fieldType: "number", unit: "kVA" },
  { section: "Dados Gerais", key: "potencia_nominal_requerida_kw", label: "Potencia nominal requerida Power (kW)", fieldType: "number", unit: "kW" },
  { section: "Dados Gerais", key: "fator_potencia_requerida", label: "Fator de potencia requerida", fieldType: "number", unit: "fP", hasDefault: true, defaultValue: 0.8 },
  { section: "Dados Gerais", key: "topologia_aterramento", label: "Topologia aterramento", fieldType: "enum", enumOptions: ["TT", "TN", "IT"] },
  { section: "Dados Gerais", key: "ruido_audivel_maximo", label: "Ruido audivel maximo", fieldType: "number", unit: "dBA", hasDefault: true, defaultValue: 78 },
  { section: "Dados Gerais", key: "grau_protecao", label: "Grau de protecao", fieldType: "text", hasDefault: true, defaultValue: "IP21" },
  { section: "Dados Gerais", key: "pressao_ar_ambiente_minima", label: "Pressao do ar ambiente minima permitida", fieldType: "number", unit: "Kpa", hasDefault: true, defaultValue: 70 },

  // Condicoes ambientais
  { section: "Condicoes ambientais", key: "elevacao_maxima", label: "Elevacao maxima", fieldType: "number", unit: "metros", hasDefault: true, defaultValue: 1000 },
  { section: "Condicoes ambientais", key: "umidade_relativa", label: "Umidade relativa", fieldType: "number", unit: "%", hasDefault: true, defaultValue: 95 },
  { section: "Condicoes ambientais", key: "h2s_concentracao_salina", label: "H2S e concentracao salina", fieldType: "number", unit: "ppm", hasDefault: true, defaultValue: 2 },
  { section: "Condicoes ambientais", key: "temperatura_max_operacao", label: "Temperatura maxima de operacao", fieldType: "number", unit: "Celso", hasDefault: true, defaultValue: 40 },
  { section: "Condicoes ambientais", key: "grau_poluicao", label: "Grau de poluicao", fieldType: "text", hasDefault: true, defaultValue: "PD2" },

  // AC Entrada Retificador (Secao 1)
  { section: "AC Entrada Retificador (Secao 1)", key: "ret_tensao_nominal", label: "Tensao nominal", fieldType: "number", unit: "Volts" },
  { section: "AC Entrada Retificador (Secao 1)", key: "ret_numero_fase", label: "Numero de fase", fieldType: "enum", enumOptions: ["2Ph", "3Ph", "3PhN"], hasDefault: true, defaultValue: "3PhN" },
  { section: "AC Entrada Retificador (Secao 1)", key: "ret_frequencia_nominal", label: "Frequencia nominal", fieldType: "number", unit: "Hz" },
  { section: "AC Entrada Retificador (Secao 1)", key: "ret_transformador_isolador", label: "Transformador Isolador", fieldType: "boolean", hasDefault: true, defaultValue: true },
  { section: "AC Entrada Retificador (Secao 1)", key: "ret_tipo_retificador", label: "Tipo retificador", fieldType: "enum", enumOptions: ["6 Pulso", "12 Pulso", "PFC"] },
  { section: "AC Entrada Retificador (Secao 1)", key: "ret_disjuntor_entrada", label: "Disjuntor entrada", fieldType: "boolean", hasDefault: true, defaultValue: false },
  { section: "AC Entrada Retificador (Secao 1)", key: "ret_max_harmonico_entrada", label: "Maximo harmonico de entrada", fieldType: "number", unit: "%", hasDefault: true, defaultValue: 5 },
  { section: "AC Entrada Retificador (Secao 1)", key: "ret_filtro_harmonico_entrada", label: "Filtro de harmonico de entrada", fieldType: "boolean", hasDefault: true, defaultValue: false },
  { section: "AC Entrada Retificador (Secao 1)", key: "ret_tol_tensao_entrada", label: "Faixa de tolerancia de tensao de entrada (+%, -%)", fieldType: "number", unit: "%", hasDefault: true, defaultValue: 10 },
  { section: "AC Entrada Retificador (Secao 1)", key: "ret_tol_freq_entrada", label: "Faixa de tolerancia de frequencia de entrada (+%, -%)", fieldType: "number", unit: "%", hasDefault: true, defaultValue: 2 },

  // AC by-pass (Secao 2)
  { section: "AC by-pass (Secao 2)", key: "byp_tensao_nominal", label: "Tensao nominal", fieldType: "number", unit: "Volts" },
  { section: "AC by-pass (Secao 2)", key: "byp_numero_fase", label: "Numero de fase", fieldType: "enum", enumOptions: ["2Ph", "3Ph", "3PhN"], hasDefault: true, defaultValue: "3PhN" },
  { section: "AC by-pass (Secao 2)", key: "byp_frequencia_nominal", label: "Frequencia nominal", fieldType: "number", unit: "Hz" },
  { section: "AC by-pass (Secao 2)", key: "byp_transformador_isolador", label: "Transformador Isolador", fieldType: "boolean", hasDefault: true, defaultValue: true },
  { section: "AC by-pass (Secao 2)", key: "byp_disjuntor_entrada", label: "Disjuntor de entrada", fieldType: "boolean", hasDefault: true, defaultValue: false },
  { section: "AC by-pass (Secao 2)", key: "byp_regulador_voltagem", label: "Regulador de voltagem", fieldType: "boolean", hasDefault: true, defaultValue: false },
  { section: "AC by-pass (Secao 2)", key: "byp_tol_tensao_entrada", label: "Faixa de tolerancia de tensao de entrada (+%, -%)", fieldType: "number", unit: "%", hasDefault: true, defaultValue: 10 },
  { section: "AC by-pass (Secao 2)", key: "byp_tol_freq_entrada", label: "Faixa de tolerancia de frequencia de entrada (+%, -%)", fieldType: "number", unit: "%", hasDefault: true, defaultValue: 2 },
  { section: "AC by-pass (Secao 2)", key: "byp_bypass_mecanico_requerido", label: "Bypass mecanico requerido", fieldType: "boolean", hasDefault: true, defaultValue: true },

  // Saida AC (Secao 3)
  { section: "Saida AC (Secao 3)", key: "out_tensao_nominal", label: "Tensao nominal", fieldType: "number", unit: "volts" },
  { section: "Saida AC (Secao 3)", key: "out_numero_fases", label: "Numero de fases", fieldType: "enum", enumOptions: ["2Ph", "3Ph", "3PhN"], hasDefault: true, defaultValue: "3PhN" },
  { section: "Saida AC (Secao 3)", key: "out_frequencia_nominal", label: "Frequencia nominal", fieldType: "number", unit: "Hz" },
  { section: "Saida AC (Secao 3)", key: "out_transformador_isolador", label: "Transformador isolador", fieldType: "boolean", hasDefault: true, defaultValue: true },
  { section: "Saida AC (Secao 3)", key: "out_chave_isolamento", label: "Chave de isolamento saida", fieldType: "boolean", hasDefault: true, defaultValue: true },
  { section: "Saida AC (Secao 3)", key: "out_tolerancia_tensao_full_load", label: "Tolerancia de tensao de saida full load", fieldType: "number", unit: "%", hasDefault: true, defaultValue: 1 },
  { section: "Saida AC (Secao 3)", key: "out_fator_potencia", label: "Fator de potencia de saida", fieldType: "number", hasDefault: true, defaultValue: 0.8 },
  { section: "Saida AC (Secao 3)", key: "out_desequilibrio_tensao", label: "Desequilibrio de tensao resultante de 100 % de razao de desequilibrio de carga", fieldType: "number", unit: "%" },

  // Store energy (bateria) (Secao 4)
  { section: "Store energy (bateria) (Secao 4)", key: "bat_tipo_bateria", label: "Tipo de Bateria", fieldType: "enum", enumOptions: ["VRLA", "NiCad", "Vent", "SMC"], hasDefault: true, defaultValue: "VRLA" },
  { section: "Store energy (bateria) (Secao 4)", key: "bat_autonomia_esperada", label: "Autonomia esperada", fieldType: "text", hasDefault: true, defaultValue: "2h" },
  { section: "Store energy (bateria) (Secao 4)", key: "bat_designer_vida", label: "Designer de vida", fieldType: "text", hasDefault: true, defaultValue: "5anos" },
  { section: "Store energy (bateria) (Secao 4)", key: "bat_fabricante_desejado", label: "Fabricante desejado", fieldType: "text" },

  // Desempenho e topologia
  { section: "Desempenho e topologia", key: "desempenho_eficiencia_acac_min", label: "Eficiencia AC/AC minima", fieldType: "number", hasDefault: true, defaultValue: 0.82 },
  { section: "Desempenho e topologia", key: "desempenho_classe", label: "Classe de desempenho", fieldType: "text", hasDefault: true, defaultValue: "VFI SS 111" },
  { section: "Desempenho e topologia", key: "desempenho_configuracao", label: "Configuracao", fieldType: "enum", enumOptions: ["Single", "Parallel", "Redundant", "Dual bus", "Bypass"] },
  { section: "Desempenho e topologia", key: "desempenho_topologia", label: "Topologia", fieldType: "enum", enumOptions: ["Double Conversion", "Line-interactive", "Standby"] }
];

async function run() {
  const existing = (await listProfiles()).find((item) => item.name === PROFILE_NAME);
  if (existing) {
    await deleteProfile(existing.id);
  }

  const profile = await createProfile({
    name: PROFILE_NAME,
    fields: []
  });

  await clearAllFieldsFromProfile(profile.id);

  for (const field of FIELD_DEFINITIONS) {
    // eslint-disable-next-line no-await-in-loop
    await createFieldInProfile(profile.id, field);
  }

  console.log(`Perfil criado com sucesso: ${PROFILE_NAME} (id=${profile.id})`);
  console.log(`Total de campos: ${FIELD_DEFINITIONS.length}`);
}

run()
  .catch((err) => {
    console.error("Erro ao criar perfil:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });

