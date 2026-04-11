const env = require("../config/env");

function stripJsonCodeFence(raw) {
  const text = String(raw || "").trim();
  if (!text.startsWith("```")) return text;
  return text
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
}

// ---- OpenAI-specific output extraction ----
function extractOutputText(responseJson) {
  if (responseJson && typeof responseJson.output_text === "string" && responseJson.output_text.trim()) {
    return responseJson.output_text;
  }

  const output = Array.isArray(responseJson && responseJson.output) ? responseJson.output : [];
  const collected = [];
  output.forEach((item) => {
    const content = Array.isArray(item && item.content) ? item.content : [];
    content.forEach((part) => {
      if (part && part.type === "output_text" && typeof part.text === "string") {
        collected.push(part.text);
      }
    });
  });
  return collected.join("\n").trim();
}

function normalizeProfileJsonShape(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("A IA retornou uma estrutura de JSON invalida.");
  }

  const name = String(parsed.name || "").trim();
  const fields = Array.isArray(parsed.fields) ? parsed.fields : [];
  if (!name) {
    throw new Error("A IA nao retornou o campo 'name' no JSON.");
  }
  if (!fields.length) {
    throw new Error("A IA nao retornou campos em 'fields'.");
  }
  return { ...parsed, name, fields };
}

function buildProfileAiPrompt({ jsonModelTemplate, userInstructions = "", promptTemplate = "" }) {
  const template = String(jsonModelTemplate || "").trim();
  const instructions = String(userInstructions || "").trim().slice(0, 4000);
  const customTemplate = String(promptTemplate || "").trim();
  if (customTemplate) {
    const instructionsBlock = instructions
      ? `Instrucoes adicionais do usuario:\n${instructions}`
      : "";
    const prompt = customTemplate
      .replace(/\{\{\s*json_model\s*\}\}/gi, template)
      .replace(/\{\{\s*user_instructions\s*\}\}/gi, instructionsBlock)
      .replace(/\{\{\s*user_instructions_raw\s*\}\}/gi, instructions);
    return String(prompt || "").trim();
  }
  const sections = [
    "Leia o documento enviado e gere um perfil de formulario JSON.",
    "O documento pode estar em PDF, TXT ou planilha Excel.",
    "Respeite exatamente a estrutura e as chaves do modelo JSON fornecido.",
    "Preencha os campos com base no documento.",
    "Quando nao houver informacao, mantenha valor coerente e conservador.",
    "Retorne somente JSON puro, sem markdown, sem explicacoes.",
    "Retorne JSON minificado (uma unica linha, sem indentacao).",
    "Garanta que o JSON esteja completo e fechado corretamente."
  ];
  if (instructions) {
    sections.push("", "Instrucoes adicionais do usuario:", instructions);
  }
  sections.push("", "Modelo JSON:", template);
  return sections.join("\n");
}

// ---- Provider helpers ----
function getActiveProvider() {
  return String(env.aiProvider || "openai").toLowerCase();
}

function getProviderConfig() {
  const provider = getActiveProvider();
  if (provider === "anthropic") return env.anthropic;
  return env.openai;
}

// ---- OpenAI caller ----
function isMaxTokensIncomplete(payload) {
  return Boolean(
    payload
    && payload.status === "incomplete"
    && payload.incomplete_details
    && payload.incomplete_details.reason === "max_output_tokens"
  );
}

async function callOpenAiResponsesApi(body) {
  const timeoutMs = env.openai.requestTimeoutMs || 300000;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${env.openai.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.openai.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (fetchErr) {
    clearTimeout(timeoutHandle);
    if (fetchErr.name === "AbortError") {
      const err = new Error(`Timeout apos ${Math.round(timeoutMs / 1000)}s aguardando resposta da OpenAI. Tente com um documento menor ou aumente OPENAI_REQUEST_TIMEOUT_MS.`);
      err.statusCode = 504;
      throw err;
    }
    throw fetchErr;
  }
  clearTimeout(timeoutHandle);

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload && payload.error && payload.error.message
      ? payload.error.message
      : "Falha ao chamar API da OpenAI.";
    const err = new Error(message);
    err.statusCode = response.status || 502;
    err.debug = { openaiResponse: payload };
    throw err;
  }
  payload._provider = "openai";
  return payload;
}

// ---- Anthropic caller ----
async function callAnthropicMessagesApi(body) {
  const cfg = env.anthropic;
  const timeoutMs = cfg.requestTimeoutMs || 300000;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${cfg.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (fetchErr) {
    clearTimeout(timeoutHandle);
    if (fetchErr.name === "AbortError") {
      const err = new Error(`Timeout apos ${Math.round(timeoutMs / 1000)}s aguardando resposta da Anthropic. Tente com um documento menor ou aumente ANTHROPIC_REQUEST_TIMEOUT_MS.`);
      err.statusCode = 504;
      throw err;
    }
    throw fetchErr;
  }
  clearTimeout(timeoutHandle);

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload && payload.error && payload.error.message
      ? payload.error.message
      : "Falha ao chamar API da Anthropic.";
    const err = new Error(message);
    err.statusCode = response.status || 502;
    err.debug = { anthropicResponse: payload };
    throw err;
  }
  payload._provider = "anthropic";
  return payload;
}

// ---- Unified output extraction and truncation detection ----
function extractAiText(payload) {
  if (payload && payload._provider === "anthropic") {
    if (!Array.isArray(payload.content) || !payload.content.length) return "";
    return String(payload.content[0].text || "").trim();
  }
  return extractOutputText(payload);
}

function isAiTruncated(payload) {
  if (payload && payload._provider === "anthropic") {
    return payload.stop_reason === "max_tokens";
  }
  return isMaxTokensIncomplete(payload);
}

// ---- Unified AI caller ----
// userParts: array of { type: "text", text } or { type: "file", dataUrl, fileName, mimeType }
async function callAiApi({ systemPrompt, userParts, maxTokens, temperature = 0.1 }) {
  const provider = getActiveProvider();
  const cfg = getProviderConfig();

  if (provider === "anthropic") {
    const content = userParts.map((part) => {
      if (part.type === "text") {
        return { type: "text", text: part.text };
      }
      // file/document
      const base64 = part.dataUrl.replace(/^data:[^;]+;base64,/, "");
      const mediaType = String(part.mimeType || "application/octet-stream").toLowerCase();
      // Anthropic documents only support PDF and plain text
      if (mediaType !== "application/pdf" && !mediaType.startsWith("text/")) {
        const err = new Error(
          `O provedor Anthropic nao suporta arquivos do tipo '${mediaType}'. Use PDF ou TXT, ou configure AI_PROVIDER=openai.`
        );
        err.statusCode = 422;
        throw err;
      }
      return {
        type: "document",
        source: {
          type: "base64",
          media_type: mediaType,
          data: base64
        }
      };
    });

    const body = {
      model: cfg.model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content }]
    };
    return callAnthropicMessagesApi(body);
  }

  // OpenAI (default)
  const inputContent = userParts.map((part) => {
    if (part.type === "text") {
      return { type: "input_text", text: part.text };
    }
    return {
      type: "input_file",
      filename: part.fileName || "documento",
      file_data: part.dataUrl
    };
  });

  const body = {
    model: cfg.model,
    temperature,
    max_output_tokens: maxTokens,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }]
      },
      {
        role: "user",
        content: inputContent
      }
    ]
  };
  return callOpenAiResponsesApi(body);
}

function stripQuillHtml(raw) {
  return String(raw || "")
    .replace(/\sclass="[^"]*"/gi, "")
    .replace(/\sstyle="[^"]*"/gi, "")
    .replace(/\sdata-[^=]+="[^"]*"/gi, "")
    .replace(/<span>/gi, "")
    .replace(/<\/span>/gi, "")
    .replace(/(<br\s*\/?>\s*){2,}/gi, "<br>")
    .trim();
}

async function generateProfileJsonFromDocument({ fileBuffer, fileName, mimeType, jsonModelTemplate, userInstructions = "", promptTemplate = "" }) {
  const provider = getActiveProvider();
  const cfg = getProviderConfig();
  const providerKeyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";

  if (!cfg.apiKey) {
    const err = new Error(`${providerKeyName} nao configurada no ambiente.`);
    err.statusCode = 500;
    throw err;
  }
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    const err = new Error("Arquivo invalido para processamento.");
    err.statusCode = 422;
    throw err;
  }

  const safeMimeType = String(mimeType || "application/octet-stream").trim().toLowerCase();
  const dataUrl = `data:${safeMimeType};base64,${fileBuffer.toString("base64")}`;
  const template = String(jsonModelTemplate || "").trim();
  if (!template) {
    const err = new Error("Modelo JSON obrigatorio.");
    err.statusCode = 422;
    throw err;
  }
  const promptText = buildProfileAiPrompt({ jsonModelTemplate: template, userInstructions, promptTemplate });
  const initialOutputTokens = Math.min(cfg.maxOutputTokens, cfg.maxOutputTokensCap);
  const maxRetries = cfg.maxOutputRetries;
  const attemptsDebug = [];

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const maxOutputTokens = Math.min(initialOutputTokens * (2 ** attempt), cfg.maxOutputTokensCap);

    // eslint-disable-next-line no-await-in-loop
    const payload = await callAiApi({
      systemPrompt: "Voce extrai requisitos de especificacao tecnica de documentos e retorna somente JSON valido.",
      userParts: [
        { type: "text", text: promptText },
        { type: "file", dataUrl, fileName: fileName || "documento", mimeType: safeMimeType }
      ],
      maxTokens: maxOutputTokens,
      temperature: 0.1
    });

    const rawText = extractAiText(payload);
    const cleanedText = stripJsonCodeFence(rawText);
    const truncatedByTokens = isAiTruncated(payload);

    attemptsDebug.push({
      attempt: attempt + 1,
      provider,
      maxOutputTokens,
      outputTextLength: cleanedText.length
    });

    if (truncatedByTokens && attempt < maxRetries) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(cleanedText);
    } catch (_err) {
      if (truncatedByTokens && attempt < maxRetries) {
        continue;
      }
      const err = new Error(
        truncatedByTokens
          ? "A resposta da IA foi truncada por limite de tokens e terminou com JSON incompleto."
          : "A IA retornou um conteudo que nao e JSON valido."
      );
      err.statusCode = 422;
      err.debug = {
        rawText,
        cleanedText,
        aiResponse: payload,
        attempts: attemptsDebug
      };
      throw err;
    }

    return {
      profileJson: normalizeProfileJsonShape(parsed),
      debug: {
        rawText,
        cleanedText,
        aiResponse: payload,
        attempts: attemptsDebug
      }
    };
  }

  const err = new Error("Nao foi possivel obter JSON completo apos as tentativas de retry.");
  err.statusCode = 422;
  err.debug = { attempts: attemptsDebug };
  throw err;
}

async function reviseTextWithAi({
  text,
  html = "",
  prompt = "Revise o texto abaixo sem mudar muitas palavras",
  systemInstruction = null,
  preserveFormatting = false,
  maxOutputTokens = null
}) {
  const provider = getActiveProvider();
  const cfg = getProviderConfig();
  const providerKeyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";

  if (!cfg.apiKey) {
    const err = new Error(`${providerKeyName} nao configurada no ambiente.`);
    err.statusCode = 500;
    throw err;
  }

  const sourceText = String(text || "").trim();
  const sourceHtml = String(html || "").trim();
  if (!sourceText && !sourceHtml) {
    const err = new Error("Texto obrigatorio para revisao.");
    err.statusCode = 422;
    throw err;
  }

  const tokenCap = maxOutputTokens
    ? Math.min(maxOutputTokens, cfg.maxOutputTokensCap)
    : Math.min(1200, cfg.maxOutputTokensCap);

  let systemPrompt;
  let userText;

  if (systemInstruction) {
    // Modo traducao: instrucao no system, texto do usuario na mensagem
    systemPrompt = String(systemInstruction).trim();
    userText = sourceText;
  } else {
    const instruction = String(prompt || "Revise o texto abaixo sem mudar muitas palavras").trim();
    const wantsHtml = Boolean(preserveFormatting);
    const cleanHtml = wantsHtml && sourceHtml ? stripQuillHtml(sourceHtml) : "";
    const reviewTarget = wantsHtml && cleanHtml
      ? `HTML:\n${cleanHtml}`
      : `Texto:\n${sourceText}`;
    const outputInstruction = wantsHtml
      ? "Retorne somente HTML revisado, sem markdown, sem explicacoes e preservando a estrutura de tags HTML."
      : "Retorne somente o texto revisado, sem explicacoes.";
    systemPrompt = "Voce revisa textos tecnicos em portugues mantendo o sentido e alterando o minimo possivel.";
    userText = `${instruction}\n\n${reviewTarget}\n\n${outputInstruction}`;
  }

  const payload = await callAiApi({
    systemPrompt,
    userParts: [{ type: "text", text: userText }],
    maxTokens: tokenCap,
    temperature: 0.2
  });

  const revised = stripJsonCodeFence(extractAiText(payload)).trim();
  if (!revised) {
    const err = new Error("A IA nao retornou texto revisado.");
    err.statusCode = 422;
    err.debug = { aiResponse: payload };
    throw err;
  }

  if (!systemInstruction && Boolean(preserveFormatting)) {
    return {
      revisedHtml: revised,
      revisedText: revised,
      debug: { aiResponse: payload }
    };
  }

  return {
    revisedText: revised,
    debug: { aiResponse: payload }
  };
}

const SPARE_PARTS_JSON_SCHEMA = JSON.stringify([
  {
    description: "Nome ou descrição da peça",
    manufacturer: "Fabricante (se disponível)",
    part_number: "Número da peça / PN / Reference",
    equipment_family: "Família ou série do equipamento",
    equipment_model: "Modelo do equipamento",
    lead_time: "Prazo de entrega (ex: 4 weeks)",
    is_obsolete: false,
    replaced_by_part_number: ""
  }
], null, 2);

const SPARE_PARTS_DEFAULT_PROMPT = `
Analise o documento enviado e extraia TODAS os componentes encontrados. 

Lembre-se de tirar todos os componentes duplicado a chave unica é PN (part_number). Se o mesmo PN aparecer mais de uma vez, mantenha somente a primeira ocorrencia e descarte as demais.

Igualdade de campos:
Chloride Reference = Part No, Part Number, PN => part_number
Material Description, Item, Component => description
Supply, Maker => manufacturer


Retorne APENAS um array JSON puro, sem markdown, sem comentários, sem texto adicional.
O JSON deve começar com [ e terminar com ].
Use exatamente os campos abaixo para cada item:

{{json_schema}}

Regras:
- part_number: número de referência/código da peça (PN, Reference, Part No, etc.)
- description: nome ou descrição da peça — obrigatório, nunca vazio
- manufacturer: fabricante (string vazia "" se não identificado)
- equipment_family = Coloque sempre APODYS1
- equipment_model: Deixe vazio
- lead_time: prazo de entrega (string vazia "" se não informado)
- is_obsolete: true somente se explicitamente marcado como obsoleto/descontinuado
- replaced_by_part_number: PN da peça substituta (string vazia "" se não aplicável)
- Inclua absolutamente TODAS as peças encontradas no documento, sem omitir nenhuma
- JSON deve estar completo, válido e sintaticamente correto`;

function getSparePartsDefaultPrompt() {
  return SPARE_PARTS_DEFAULT_PROMPT.replace("{{json_schema}}", SPARE_PARTS_JSON_SCHEMA);
}

function getSparePartsJsonSchema() {
  return SPARE_PARTS_JSON_SCHEMA;
}

function buildSparePartsPrompt(promptTemplate) {
  const template = String(promptTemplate || SPARE_PARTS_DEFAULT_PROMPT).trim();
  return template.replace(/\{\{\s*json_schema\s*\}\}/gi, SPARE_PARTS_JSON_SCHEMA);
}

async function extractSparePartsFromDocument({ fileBuffer, fileName, mimeType, promptTemplate = "" }) {
  const provider = getActiveProvider();
  const cfg = getProviderConfig();
  const providerKeyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";

  if (!cfg.apiKey) {
    const err = new Error(`${providerKeyName} nao configurada no ambiente.`);
    err.statusCode = 500;
    throw err;
  }
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    const err = new Error("Arquivo invalido para processamento.");
    err.statusCode = 422;
    throw err;
  }

  const safeMimeType = String(mimeType || "application/octet-stream").trim().toLowerCase();
  const dataUrl = `data:${safeMimeType};base64,${fileBuffer.toString("base64")}`;
  const promptText = buildSparePartsPrompt(promptTemplate);
  const initialOutputTokens = Math.min(cfg.maxOutputTokens, cfg.maxOutputTokensCap);
  const maxRetries = cfg.maxOutputRetries;
  const attemptsDebug = [];

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const maxOutputTokens = Math.min(initialOutputTokens * (2 ** attempt), cfg.maxOutputTokensCap);

    // eslint-disable-next-line no-await-in-loop
    const payload = await callAiApi({
      systemPrompt: "Voce extrai listas de spare parts de documentos tecnicos e retorna somente JSON valido (array).",
      userParts: [
        { type: "text", text: promptText },
        { type: "file", dataUrl, fileName: fileName || "documento", mimeType: safeMimeType }
      ],
      maxTokens: maxOutputTokens,
      temperature: 0.1
    });

    const rawText = extractAiText(payload);
    const cleanedText = stripJsonCodeFence(rawText);
    const truncatedByTokens = isAiTruncated(payload);

    attemptsDebug.push({
      attempt: attempt + 1,
      provider,
      maxOutputTokens,
      outputTextLength: cleanedText.length
    });

    if (truncatedByTokens && attempt < maxRetries) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(cleanedText);
    } catch (_err) {
      if (truncatedByTokens && attempt < maxRetries) {
        continue;
      }
      const err = new Error(
        truncatedByTokens
          ? "A resposta da IA foi truncada e terminou com JSON incompleto."
          : "A IA retornou conteudo que nao e JSON valido."
      );
      err.statusCode = 422;
      err.debug = { rawText, cleanedText, aiResponse: payload, attempts: attemptsDebug };
      throw err;
    }

    if (!Array.isArray(parsed)) {
      const err = new Error("A IA nao retornou um array JSON de spare parts.");
      err.statusCode = 422;
      err.debug = { rawText, cleanedText, aiResponse: payload, attempts: attemptsDebug };
      throw err;
    }

    return {
      spareParts: parsed,
      debug: { rawText, cleanedText, aiResponse: payload, attempts: attemptsDebug }
    };
  }

  const err = new Error("Nao foi possivel obter JSON completo apos as tentativas de retry.");
  err.statusCode = 422;
  err.debug = { attempts: attemptsDebug };
  throw err;
}

module.exports = {
  generateProfileJsonFromDocument,
  buildProfileAiPrompt,
  reviseTextWithAi,
  extractSparePartsFromDocument,
  getSparePartsDefaultPrompt,
  getSparePartsJsonSchema
};
