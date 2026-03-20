const SECTION_ORDER = [
  "Dados Gerais",
  "Condições Ambientais",
  "AC Entrada Retificador",
  "AC Bypass",
  "Saída AC",
  "Armazenamento de Energia (Bateria)",
  "Desempenho e Topologia"
];

const FIELDS_SEED = [
  { key: "geral_potencia_nominal_requerida_kva", label: "Potência nominal requerida", section: "Dados Gerais", fieldType: "number", unit: "kVA" },
  { key: "geral_potencia_nominal_requerida_kw", label: "Potência nominal requerida", section: "Dados Gerais", fieldType: "number", unit: "kW" },
  { key: "geral_fator_potencia_requerido", label: "Fator de potência requerido", section: "Dados Gerais", fieldType: "number", unit: "fp", hasDefault: true, defaultValue: 0.8 },
  { key: "geral_topologia_aterramento", label: "Topologia de aterramento", section: "Dados Gerais", fieldType: "enum", enumOptions: ["TT", "TN", "IT"] },
  { key: "geral_ruido_audivel_maximo", label: "Ruído audível máximo", section: "Dados Gerais", fieldType: "number", unit: "dBA", hasDefault: true, defaultValue: 78 },
  { key: "geral_grau_protecao", label: "Grau de proteção", section: "Dados Gerais", fieldType: "text", hasDefault: true, defaultValue: "IP21" },
  { key: "geral_pressao_minima_ar_ambiente", label: "Pressão mínima do ar ambiente permitida", section: "Dados Gerais", fieldType: "number", unit: "kPa", hasDefault: true, defaultValue: 70 },

  { key: "ambiental_elevacao_maxima", label: "Elevação máxima", section: "Condições Ambientais", fieldType: "number", unit: "metros", hasDefault: true, defaultValue: 1000 },
  { key: "ambiental_umidade_relativa", label: "Umidade relativa", section: "Condições Ambientais", fieldType: "number", unit: "%", hasDefault: true, defaultValue: 95 },
  { key: "ambiental_h2s_concentracao_salina", label: "H2S e concentração salina", section: "Condições Ambientais", fieldType: "number", unit: "ppm", hasDefault: true, defaultValue: 2 },
  { key: "ambiental_temperatura_maxima_operacao", label: "Temperatura máxima de operação", section: "Condições Ambientais", fieldType: "number", unit: "°C", hasDefault: true, defaultValue: 40 },
  { key: "ambiental_grau_poluicao", label: "Grau de poluição", section: "Condições Ambientais", fieldType: "text", hasDefault: true, defaultValue: "PD2" },

  { key: "retificador_tensao_nominal", label: "Tensão nominal", section: "AC Entrada Retificador", fieldType: "number", unit: "volts" },
  { key: "retificador_numero_fases", label: "Número de fases", section: "AC Entrada Retificador", fieldType: "enum", enumOptions: ["2Ph", "3Ph", "3PhN"], hasDefault: true, defaultValue: "3PhN" },
  { key: "retificador_frequencia_nominal", label: "Frequência nominal", section: "AC Entrada Retificador", fieldType: "number", unit: "Hz" },
  { key: "retificador_transformador_isolador", label: "Transformador isolador", section: "AC Entrada Retificador", fieldType: "boolean", hasDefault: true, defaultValue: true },
  { key: "retificador_tipo_retificador", label: "Tipo de retificador", section: "AC Entrada Retificador", fieldType: "enum", enumOptions: ["6 Pulsos", "12 Pulsos", "PFC"] },
  { key: "retificador_disjuntor_entrada", label: "Disjuntor de entrada", section: "AC Entrada Retificador", fieldType: "boolean", hasDefault: true, defaultValue: false },
  { key: "retificador_maximo_harmonico_entrada", label: "Máximo harmônico de entrada", section: "AC Entrada Retificador", fieldType: "number", unit: "%", hasDefault: true, defaultValue: 5 },
  { key: "retificador_filtro_harmonicos_entrada", label: "Filtro de harmônicos de entrada", section: "AC Entrada Retificador", fieldType: "boolean", hasDefault: true, defaultValue: false },
  { key: "retificador_faixa_tolerancia_tensao_entrada", label: "Faixa de tolerância de tensão de entrada", section: "AC Entrada Retificador", fieldType: "number", unit: "%", hasDefault: true, defaultValue: 10 },
  { key: "retificador_faixa_tolerancia_frequencia_entrada", label: "Faixa de tolerância de frequência de entrada", section: "AC Entrada Retificador", fieldType: "number", unit: "%", hasDefault: true, defaultValue: 2 },

  { key: "bypass_tensao_nominal", label: "Tensão nominal", section: "AC Bypass", fieldType: "number", unit: "volts" },
  { key: "bypass_numero_fases", label: "Número de fases", section: "AC Bypass", fieldType: "enum", enumOptions: ["2Ph", "3Ph", "3PhN"], hasDefault: true, defaultValue: "3PhN" },
  { key: "bypass_frequencia_nominal", label: "Frequência nominal", section: "AC Bypass", fieldType: "number", unit: "Hz" },
  { key: "bypass_transformador_isolador", label: "Transformador isolador", section: "AC Bypass", fieldType: "boolean", hasDefault: true, defaultValue: true },
  { key: "bypass_disjuntor_entrada", label: "Disjuntor de entrada", section: "AC Bypass", fieldType: "boolean", hasDefault: true, defaultValue: false },
  { key: "bypass_regulador_tensao", label: "Regulador de tensão", section: "AC Bypass", fieldType: "boolean", hasDefault: true, defaultValue: false },
  { key: "bypass_faixa_tolerancia_tensao_entrada", label: "Faixa de tolerância de tensão de entrada", section: "AC Bypass", fieldType: "number", unit: "%", hasDefault: true, defaultValue: 10 },
  { key: "bypass_faixa_tolerancia_frequencia_entrada", label: "Faixa de tolerância de frequência de entrada", section: "AC Bypass", fieldType: "number", unit: "%", hasDefault: true, defaultValue: 2 },
  { key: "bypass_mecanico_requerido", label: "Bypass mecânico requerido", section: "AC Bypass", fieldType: "boolean", hasDefault: true, defaultValue: true },

  { key: "saida_tensao_nominal", label: "Tensão nominal", section: "Saída AC", fieldType: "number", unit: "volts" },
  { key: "saida_numero_fases", label: "Número de fases", section: "Saída AC", fieldType: "enum", enumOptions: ["2Ph", "3Ph", "3PhN"], hasDefault: true, defaultValue: "3PhN" },
  { key: "saida_frequencia_nominal", label: "Frequência nominal", section: "Saída AC", fieldType: "number", unit: "Hz" },
  { key: "saida_transformador_isolador", label: "Transformador isolador", section: "Saída AC", fieldType: "boolean", hasDefault: true, defaultValue: true },
  { key: "saida_chave_isolamento_saida", label: "Chave de isolamento de saída", section: "Saída AC", fieldType: "boolean", hasDefault: true, defaultValue: true },
  { key: "saida_tolerancia_tensao_saida_carga_total", label: "Tolerância de tensão de saída em carga total", section: "Saída AC", fieldType: "number", unit: "%", hasDefault: true, defaultValue: 1 },
  { key: "saida_fator_potencia_saida", label: "Fator de potência de saída", section: "Saída AC", fieldType: "number", hasDefault: true, defaultValue: 0.8 },
  { key: "saida_desequilibrio_tensao_carga_100", label: "Desequilíbrio de tensão com 100% de desequilíbrio de carga", section: "Saída AC", fieldType: "number", unit: "%" },

  { key: "bateria_tipo", label: "Tipo de bateria", section: "Armazenamento de Energia (Bateria)", fieldType: "enum", enumOptions: ["VRLA", "NiCad", "Vent", "SMC"], hasDefault: true, defaultValue: "VRLA" },
  { key: "bateria_autonomia_esperada", label: "Autonomia esperada", section: "Armazenamento de Energia (Bateria)", fieldType: "text", hasDefault: true, defaultValue: "2h" },
  { key: "bateria_vida_util_projeto", label: "Vida útil de projeto", section: "Armazenamento de Energia (Bateria)", fieldType: "text", hasDefault: true, defaultValue: "5 anos" },
  { key: "bateria_fabricante_desejado", label: "Fabricante desejado", section: "Armazenamento de Energia (Bateria)", fieldType: "text" },

  { key: "desempenho_eficiencia_ac_ac_minima", label: "Eficiência AC/AC mínima", section: "Desempenho e Topologia", fieldType: "number", hasDefault: true, defaultValue: 0.82 },
  { key: "desempenho_classe", label: "Classe de desempenho", section: "Desempenho e Topologia", fieldType: "text", hasDefault: true, defaultValue: "VFI SS 111" },
  { key: "desempenho_configuracao", label: "Configuração", section: "Desempenho e Topologia", fieldType: "enum", enumOptions: ["Single", "Parallel", "Redundant", "Dual Bus", "Bypass"] },
  { key: "desempenho_topologia", label: "Topologia", section: "Desempenho e Topologia", fieldType: "enum", enumOptions: ["Double Conversion", "Line-interactive", "Standby"] }
];

function getSectionLabel(section) {
  return section;
}

function getFieldLabel(_key, fallbackLabel) {
  return fallbackLabel;
}

module.exports = {
  SECTION_ORDER,
  FIELDS_SEED,
  getSectionLabel,
  getFieldLabel
};
