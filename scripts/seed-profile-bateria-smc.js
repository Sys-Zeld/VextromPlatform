const db = require("../specflow/db");
const {
  listProfiles,
  deleteProfile,
  createProfile,
  clearAllFieldsFromProfile,
  createFieldInProfile
} = require("../specflow/services/profiles");

const PROFILE_NAME = "Bateria SMC";

const FIELD_DEFINITIONS = [
  // 3. Dados da Aplicacao
  { section: "3. Dados da Aplicacao", key: "smc_tipo_aplicacao", label: "Tipo de aplicacao", fieldType: "enum", enumOptions: ["UPS industrial", "UPS data center", "Telecom", "Subestacao", "Oleo e gas", "Outro"] },
  { section: "3. Dados da Aplicacao", key: "smc_tipo_aplicacao_outro", label: "Tipo de aplicacao (outro)", fieldType: "text" },
  { section: "3. Dados da Aplicacao", key: "smc_finalidade_bateria", label: "Finalidade da bateria", fieldType: "enum", enumOptions: ["Back-up em falha da rede", "Suporte ao inversor", "Alimentacao de carga critica DC", "Outro"] },
  { section: "3. Dados da Aplicacao", key: "smc_finalidade_bateria_outro", label: "Finalidade da bateria (outro)", fieldType: "text" },
  { section: "3. Dados da Aplicacao", key: "smc_tensao_nominal_sistema_dc", label: "Tensao nominal do sistema DC", fieldType: "number", unit: "Vcc" },
  { section: "3. Dados da Aplicacao", key: "smc_faixa_operacional_min_vcc", label: "Faixa operacional requerida minima", fieldType: "number", unit: "Vcc" },
  { section: "3. Dados da Aplicacao", key: "smc_faixa_operacional_max_vcc", label: "Faixa operacional requerida maxima", fieldType: "number", unit: "Vcc" },
  { section: "3. Dados da Aplicacao", key: "smc_potencia_carga_kw", label: "Potencia da carga", fieldType: "number", unit: "kW" },
  { section: "3. Dados da Aplicacao", key: "smc_corrente_carga_a", label: "Corrente da carga", fieldType: "number", unit: "A" },
  { section: "3. Dados da Aplicacao", key: "smc_fator_potencia_carga", label: "Fator de potencia da carga (se aplicavel)", fieldType: "number" },
  { section: "3. Dados da Aplicacao", key: "smc_rendimento_sistema_percentual", label: "Rendimento do sistema considerado", fieldType: "number", unit: "%" },
  { section: "3. Dados da Aplicacao", key: "smc_tempo_autonomia_min", label: "Tempo de autonomia requerido (min)", fieldType: "number", unit: "min" },
  { section: "3. Dados da Aplicacao", key: "smc_tempo_autonomia_h", label: "Tempo de autonomia requerido (h)", fieldType: "number", unit: "h" },

  // 4. Requisitos Eletricos da Bateria
  { section: "4. Requisitos Eletricos da Bateria", key: "smc_tecnologia_bateria", label: "Tecnologia", fieldType: "text", hasDefault: true, defaultValue: "Sodium Metal Chloride (SMC)" },
  { section: "4. Requisitos Eletricos da Bateria", key: "smc_fabricante_bateria", label: "Fabricante", fieldType: "enum", enumOptions: ["Horien", "Equivalente aprovado"], hasDefault: true, defaultValue: "Horien" },
  { section: "4. Requisitos Eletricos da Bateria", key: "smc_capacidade_nominal_min_ah", label: "Capacidade nominal minima", fieldType: "number", unit: "Ah" },
  { section: "4. Requisitos Eletricos da Bateria", key: "smc_tensao_nominal_banco_vcc", label: "Tensao nominal do banco", fieldType: "number", unit: "Vcc" },
  { section: "4. Requisitos Eletricos da Bateria", key: "smc_numero_modulos_blocos", label: "Numero de modulos / blocos", fieldType: "number" },
  { section: "4. Requisitos Eletricos da Bateria", key: "smc_configuracao_banco", label: "Configuracao do banco", fieldType: "enum", enumOptions: ["Serie", "Paralelo", "Serie-paralelo"] },
  { section: "4. Requisitos Eletricos da Bateria", key: "smc_corrente_max_descarga_continua_a", label: "Corrente maxima de descarga continua", fieldType: "number", unit: "A" },
  { section: "4. Requisitos Eletricos da Bateria", key: "smc_corrente_max_carga_a", label: "Corrente maxima de carga", fieldType: "number", unit: "A" },
  { section: "4. Requisitos Eletricos da Bateria", key: "smc_tempo_recarga_requerido_h", label: "Tempo de recarga requerido", fieldType: "number", unit: "h" },
  { section: "4. Requisitos Eletricos da Bateria", key: "smc_regime_operacao", label: "Regime de operacao", fieldType: "enum", enumOptions: ["Flutuacao / stand-by", "Ciclagem eventual", "Ciclagem frequente"] },
  { section: "4. Requisitos Eletricos da Bateria", key: "smc_compat_ups_fabricante", label: "Compatibilidade com UPS - Fabricante UPS", fieldType: "text" },
  { section: "4. Requisitos Eletricos da Bateria", key: "smc_compat_ups_modelo", label: "Compatibilidade com UPS - Modelo UPS", fieldType: "text" },
  { section: "4. Requisitos Eletricos da Bateria", key: "smc_compat_ups_tensao_barramento_dc", label: "Compatibilidade com UPS - Tensao DC do barramento", fieldType: "text" },
  { section: "4. Requisitos Eletricos da Bateria", key: "smc_compat_ups_interface_integracao", label: "Compatibilidade com UPS - Interface/Integracao requerida", fieldType: "text" },

  // 5. Requisitos Ambientais e de Instalacao
  { section: "5. Requisitos Ambientais e de Instalacao", key: "smc_temp_operacao_min_c", label: "Temperatura ambiente de operacao minima", fieldType: "number", unit: "C" },
  { section: "5. Requisitos Ambientais e de Instalacao", key: "smc_temp_operacao_max_c", label: "Temperatura ambiente de operacao maxima", fieldType: "number", unit: "C" },
  { section: "5. Requisitos Ambientais e de Instalacao", key: "smc_temp_armazenamento_min_c", label: "Temperatura ambiente de armazenamento minima", fieldType: "number", unit: "C" },
  { section: "5. Requisitos Ambientais e de Instalacao", key: "smc_temp_armazenamento_max_c", label: "Temperatura ambiente de armazenamento maxima", fieldType: "number", unit: "C" },
  { section: "5. Requisitos Ambientais e de Instalacao", key: "smc_altitude_local_m", label: "Altitude do local", fieldType: "number", unit: "m" },
  { section: "5. Requisitos Ambientais e de Instalacao", key: "smc_grau_protecao_requerido", label: "Grau de protecao requerido", fieldType: "text" },
  { section: "5. Requisitos Ambientais e de Instalacao", key: "smc_instalacao_ambiente", label: "Instalacao em ambiente", fieldType: "enum", enumOptions: ["Interno", "Externo", "Abrigado", "Offshore", "Area industrial severa"] },
  { section: "5. Requisitos Ambientais e de Instalacao", key: "smc_requisitos_adicionais_local", label: "Requisitos adicionais do local", fieldType: "text" },

  // 6. Caracteristicas Construtivas Requeridas
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_incluir_modulos_bateria", label: "Incluir modulos de bateria SMC", fieldType: "boolean" },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_incluir_estrutura_rack_gabinete", label: "Incluir estrutura / rack / gabinete", fieldType: "boolean" },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_incluir_cabos_interligacao", label: "Incluir cabos de interligacao", fieldType: "boolean" },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_incluir_terminais_conectores", label: "Incluir terminais e conectores", fieldType: "boolean" },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_incluir_dispositivo_protecao", label: "Incluir dispositivo de protecao", fieldType: "boolean" },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_incluir_monitoramento_bms", label: "Incluir sistema de monitoramento / BMS", fieldType: "boolean" },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_incluir_interface_comunicacao", label: "Incluir interface de comunicacao", fieldType: "boolean" },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_incluir_protecoes_adicionais", label: "Incluir resistores / fusiveis / disjuntores (se aplicavel)", fieldType: "boolean" },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_incluir_etiquetas_identificacao", label: "Incluir etiquetas e identificacao dos modulos", fieldType: "boolean" },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_incluir_manual_instalacao_operacao", label: "Incluir manual de instalacao e operacao", fieldType: "boolean" },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_tipo_montagem", label: "Tipo de montagem", fieldType: "enum", enumOptions: ["Rack", "Gabinete", "Skid", "Integrado ao UPS", "Outro"] },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_tipo_montagem_outro", label: "Tipo de montagem (outro)", fieldType: "text" },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_dimensao_max_largura_mm", label: "Dimensao maxima permitida - Largura", fieldType: "number", unit: "mm" },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_dimensao_max_profundidade_mm", label: "Dimensao maxima permitida - Profundidade", fieldType: "number", unit: "mm" },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_dimensao_max_altura_mm", label: "Dimensao maxima permitida - Altura", fieldType: "number", unit: "mm" },
  { section: "6. Caracteristicas Construtivas Requeridas", key: "smc_peso_maximo_kg", label: "Peso maximo permitido", fieldType: "number", unit: "kg" },

  // 7. Monitoramento e Comunicacao
  { section: "7. Monitoramento e Comunicacao", key: "smc_monitorar_tensao_total_banco", label: "Supervisao - Tensao total do banco", fieldType: "boolean" },
  { section: "7. Monitoramento e Comunicacao", key: "smc_monitorar_corrente_carga_descarga", label: "Supervisao - Corrente de carga/descarga", fieldType: "boolean" },
  { section: "7. Monitoramento e Comunicacao", key: "smc_monitorar_estado_operacional", label: "Supervisao - Estado operacional", fieldType: "boolean" },
  { section: "7. Monitoramento e Comunicacao", key: "smc_monitorar_alarmes_falha", label: "Supervisao - Alarmes de falha", fieldType: "boolean" },
  { section: "7. Monitoramento e Comunicacao", key: "smc_monitorar_temperatura_interna", label: "Supervisao - Temperatura interna", fieldType: "boolean" },
  { section: "7. Monitoramento e Comunicacao", key: "smc_monitorar_estado_saude", label: "Supervisao - Estado de saude / diagnostico", fieldType: "boolean" },
  { section: "7. Monitoramento e Comunicacao", key: "smc_monitorar_comunicacao_remota", label: "Supervisao - Comunicacao remota", fieldType: "boolean" },
  { section: "7. Monitoramento e Comunicacao", key: "smc_protocolo_modbus_rtu", label: "Protocolo desejado - Modbus RTU", fieldType: "boolean" },
  { section: "7. Monitoramento e Comunicacao", key: "smc_protocolo_modbus_tcp", label: "Protocolo desejado - Modbus TCP", fieldType: "boolean" },
  { section: "7. Monitoramento e Comunicacao", key: "smc_protocolo_snmp", label: "Protocolo desejado - SNMP", fieldType: "boolean" },
  { section: "7. Monitoramento e Comunicacao", key: "smc_protocolo_contatos_secos", label: "Protocolo desejado - Contatos secos", fieldType: "boolean" },
  { section: "7. Monitoramento e Comunicacao", key: "smc_protocolo_can", label: "Protocolo desejado - CAN", fieldType: "boolean" },
  { section: "7. Monitoramento e Comunicacao", key: "smc_protocolo_outro_descricao", label: "Protocolo desejado - Outro", fieldType: "text" },

  // 8. Requisitos de Desempenho
  { section: "8. Requisitos de Desempenho", key: "smc_desempenho_curva_descarga", label: "Curva de descarga", fieldType: "text" },
  { section: "8. Requisitos de Desempenho", key: "smc_desempenho_capacidade_autonomia", label: "Capacidade na autonomia requerida", fieldType: "text" },
  { section: "8. Requisitos de Desempenho", key: "smc_desempenho_corrente_max_suportada", label: "Corrente maxima suportada", fieldType: "text" },
  { section: "8. Requisitos de Desempenho", key: "smc_desempenho_tempo_recarga", label: "Tempo de recarga", fieldType: "text" },
  { section: "8. Requisitos de Desempenho", key: "smc_desempenho_vida_util_esperada", label: "Vida util esperada", fieldType: "text" },
  { section: "8. Requisitos de Desempenho", key: "smc_desempenho_eficiencia_sistema", label: "Eficiencia do sistema", fieldType: "text" },
  { section: "8. Requisitos de Desempenho", key: "smc_desempenho_condicoes_temperatura", label: "Condicoes de operacao em alta e baixa temperatura", fieldType: "text" },
  { section: "8. Requisitos de Desempenho", key: "smc_desempenho_requisitos_aquecimento", label: "Requisitos de aquecimento interno (se aplicavel)", fieldType: "text" },
  { section: "8. Requisitos de Desempenho", key: "smc_desempenho_armazenamento_prolongado", label: "Comportamento em armazenamento prolongado", fieldType: "text" },
  { section: "8. Requisitos de Desempenho", key: "smc_desempenho_manutencao_preventiva", label: "Requisitos de manutencao preventiva", fieldType: "text" },

  // 9. Requisitos de Seguranca
  { section: "9. Requisitos de Seguranca", key: "smc_seguranca_eletrica", label: "Seguranca eletrica", fieldType: "boolean" },
  { section: "9. Requisitos de Seguranca", key: "smc_seguranca_curto_circuito", label: "Protecao contra curto-circuito", fieldType: "boolean" },
  { section: "9. Requisitos de Seguranca", key: "smc_seguranca_sobretemperatura", label: "Protecao contra sobretemperatura", fieldType: "boolean" },
  { section: "9. Requisitos de Seguranca", key: "smc_seguranca_sobrecorrente", label: "Protecao contra sobrecorrente", fieldType: "boolean" },
  { section: "9. Requisitos de Seguranca", key: "smc_seguranca_diagnostico_falha", label: "Diagnostico de falha interna", fieldType: "boolean" },
  { section: "9. Requisitos de Seguranca", key: "smc_seguranca_documentacao_manuseio", label: "Documentacao de seguranca e manuseio", fieldType: "boolean" },
  { section: "9. Requisitos de Seguranca", key: "smc_normas_referencias_desejadas", label: "Normas/referencias desejadas", fieldType: "text" },

  // 10. Documentacao Tecnica a Ser Fornecida
  { section: "10. Documentacao Tecnica", key: "smc_doc_datasheet_modelo", label: "Documentacao - Datasheet do modelo ofertado", fieldType: "boolean" },
  { section: "10. Documentacao Tecnica", key: "smc_doc_curvas_descarga", label: "Documentacao - Curvas de descarga", fieldType: "boolean" },
  { section: "10. Documentacao Tecnica", key: "smc_doc_desenho_dimensional", label: "Documentacao - Desenho dimensional", fieldType: "boolean" },
  { section: "10. Documentacao Tecnica", key: "smc_doc_peso_centro_gravidade", label: "Documentacao - Peso e centro de gravidade", fieldType: "boolean" },
  { section: "10. Documentacao Tecnica", key: "smc_doc_manual_instalacao", label: "Documentacao - Manual de instalacao", fieldType: "boolean" },
  { section: "10. Documentacao Tecnica", key: "smc_doc_manual_operacao_manutencao", label: "Documentacao - Manual de operacao e manutencao", fieldType: "boolean" },
  { section: "10. Documentacao Tecnica", key: "smc_doc_certificados_conformidades", label: "Documentacao - Certificados e conformidades", fieldType: "boolean" },
  { section: "10. Documentacao Tecnica", key: "smc_doc_lista_pecas_acessorios", label: "Documentacao - Lista de pecas e acessorios", fieldType: "boolean" },
  { section: "10. Documentacao Tecnica", key: "smc_doc_diagrama_interligacao", label: "Documentacao - Diagrama de interligacao", fieldType: "boolean" },
  { section: "10. Documentacao Tecnica", key: "smc_doc_requisitos_comissionamento", label: "Documentacao - Requisitos de comissionamento", fieldType: "boolean" },
  { section: "10. Documentacao Tecnica", key: "smc_doc_procedimento_armazenamento_transporte", label: "Documentacao - Procedimento de armazenamento/transporte", fieldType: "boolean" },

  // 11. Escopo de Servicos
  { section: "11. Escopo de Servicos", key: "smc_servicos_apenas_materiais", label: "Escopo - Apenas materiais", fieldType: "boolean" },
  { section: "11. Escopo de Servicos", key: "smc_servicos_supervisao_instalacao", label: "Escopo - Supervisao de instalacao", fieldType: "boolean" },
  { section: "11. Escopo de Servicos", key: "smc_servicos_comissionamento", label: "Escopo - Comissionamento", fieldType: "boolean" },
  { section: "11. Escopo de Servicos", key: "smc_servicos_startup", label: "Escopo - Start-up", fieldType: "boolean" },
  { section: "11. Escopo de Servicos", key: "smc_servicos_treinamento_operacional", label: "Escopo - Treinamento operacional", fieldType: "boolean" },
  { section: "11. Escopo de Servicos", key: "smc_servicos_testes_aceitacao_campo", label: "Escopo - Testes de aceitacao em campo", fieldType: "boolean" },
  { section: "11. Escopo de Servicos", key: "smc_servicos_testes_autonomia", label: "Escopo - Testes de autonomia", fieldType: "boolean" },
  { section: "11. Escopo de Servicos", key: "smc_servicos_garantia_estendida", label: "Escopo - Garantia estendida", fieldType: "boolean" }
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

  // eslint-disable-next-line no-console
  console.log(`Perfil criado com sucesso: ${PROFILE_NAME} (id=${profile.id})`);
  // eslint-disable-next-line no-console
  console.log(`Total de campos: ${FIELD_DEFINITIONS.length}`);
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Erro ao criar perfil:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });

