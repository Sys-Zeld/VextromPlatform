const ORDER_STATUSES = [
  "draft",
  "valid",
  "in_progress",
  "waiting_review",
  "approved",
  "issued",
  "closed",
  "cancelled"
];

const REPORT_STATUSES = [
  "draft",
  "in_progress",
  "waiting_review",
  "approved",
  "issued",
  "closed",
  "cancelled"
];

const SECTION_DEFINITIONS = [
  { key: "scope", title: "ESCOPO", sortOrder: 1 },
  { key: "technical_description", title: "DESCRIÇÃO TECNICA", sortOrder: 2 },
  { key: "replaced_components", title: "COMPONENTES SUBSTITUIDOS NA CORRETIVA", sortOrder: 3 },
  { key: "required_components", title: "COMPONENTES NECESSARIOS PARA CORRETIVA", sortOrder: 4 },
  { key: "recommended_spare", title: "COMPONENTES RECOMENDADOS PARA SPARE", sortOrder: 5 },
  { key: "recommendations", title: "RECOMENDAÇÕES", sortOrder: 6 },
  { key: "conclusion", title: "CONCLUSÃO", sortOrder: 7 }
];

const QUILL_SECTION_TOOLBAR = [
  [{ font: ["arial", "serif", "monospace"] }, { size: ["small", false, "large", "huge"] }],
  [{ header: [1, 2, 3, false] }],
  ["bold", "italic", "underline", { color: [] }],
  [{ list: "ordered" }, { list: "bullet" }],
  ["blockquote"],
  [{ align: [] }],
  ["insertTable"],
  ["link", "image"],
  ["clean"]
];

const QUILL_SECTION_TITLE_TOOLBAR = [
  [{ font: ["arial", "serif", "monospace"] }, { size: ["small", false, "large", "huge"] }],
  ["bold", "italic", "underline", { color: [] }],
  [{ align: [] }],
  ["link", "image"],
  ["clean"]
];

const QUILL_SECTION_FORMATS = [
  "font",
  "size",
  "color",
  "header",
  "bold",
  "italic",
  "underline",
  "list",
  "blockquote",
  "align",
  "table",
  "table-cell-line",
  "table-col",
  "table-row",
  "link",
  "image"
];

const QUILL_SECTION_TITLE_FORMATS = [
  "font",
  "size",
  "color",
  "bold",
  "italic",
  "underline",
  "align",
  "link",
  "image"
];

const COMPONENT_CATEGORIES = ["replaced", "required", "spare_recommended"];
const SIGNER_TYPES = ["vextrom_technician", "customer_responsible"];
const SECTION_SEED_HTML = {
  scope: "<p><strong>Escopo:</strong> Execucao de manutencao corretiva e verificacao funcional do sistema UPS, incluindo validacao de tempos de resposta e inspeção dos conjuntos de potencia.</p><p>O atendimento contempla equipe tecnica Vextrom, instrumentos calibrados, registro de timesheet e rastreabilidade de componentes.</p>",
  technical_description: "<p><strong>Dia 1:</strong> Inspecao inicial, verificacao de alarmes historicos, medições de tensao e frequencia, e testes de transferencia.</p><p><strong>Dia 2:</strong> Ajustes em blocos de potencia, substituicao de itens avariados e testes de estabilidade em carga controlada.</p>",
  replaced_components: "<p>Componentes substituidos durante a corretiva conforme tabela tecnica do relatorio.</p>",
  required_components: "<p>Itens identificados como necessarios para corretiva complementar, sujeitos a aprovacao do cliente.</p>",
  recommended_spare: "<p>Lista recomendada de sobressalentes para reduzir indisponibilidade em ocorrencias futuras.</p>",
  recommendations: "<p>Recomenda-se executar inspeções preventivas trimestrais, validacao termografica semestral e atualizacao do plano de contingencia operacional.</p>",
  conclusion: "<p>Conclui-se que o sistema retornou a condicao operacional esperada apos intervencao tecnica, com desempenho estavel e sem alarmes criticos ativos.</p>"
};

module.exports = {
  ORDER_STATUSES,
  REPORT_STATUSES,
  SECTION_DEFINITIONS,
  QUILL_SECTION_TOOLBAR,
  QUILL_SECTION_TITLE_TOOLBAR,
  QUILL_SECTION_FORMATS,
  QUILL_SECTION_TITLE_FORMATS,
  COMPONENT_CATEGORIES,
  SIGNER_TYPES,
  SECTION_SEED_HTML
};
