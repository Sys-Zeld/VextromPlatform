const env = require("../config/env");

function stripJsonCodeFence(raw) {
  const text = String(raw || "").trim();
  if (!text.startsWith("```")) return text;
  return text
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
}

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

function isMaxTokensIncomplete(payload) {
  return Boolean(
    payload
    && payload.status === "incomplete"
    && payload.incomplete_details
    && payload.incomplete_details.reason === "max_output_tokens"
  );
}

async function callOpenAiResponsesApi(body) {
  const response = await fetch(`${env.openai.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.openai.apiKey}`
    },
    body: JSON.stringify(body)
  });

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
  return payload;
}

async function generateProfileJsonFromDocument({ fileBuffer, fileName, mimeType, jsonModelTemplate, userInstructions = "", promptTemplate = "" }) {
  if (!env.openai.apiKey) {
    const err = new Error("OPENAI_API_KEY nao configurada no ambiente.");
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
  const initialOutputTokens = Math.min(env.openai.maxOutputTokens, env.openai.maxOutputTokensCap);
  const maxRetries = env.openai.maxOutputRetries;
  const attemptsDebug = [];

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const maxOutputTokens = Math.min(initialOutputTokens * (2 ** attempt), env.openai.maxOutputTokensCap);
    const body = {
      model: env.openai.model,
      temperature: 0.1,
      max_output_tokens: maxOutputTokens,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "Voce extrai requisitos de especificacao tecnica de documentos e retorna somente JSON valido."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: promptText
            },
            {
              type: "input_file",
              filename: fileName || "documento",
              file_data: dataUrl
            }
          ]
        }
      ]
    };

    // eslint-disable-next-line no-await-in-loop
    const payload = await callOpenAiResponsesApi(body);
    const rawText = extractOutputText(payload);
    const cleanedText = stripJsonCodeFence(rawText);
    const truncatedByTokens = isMaxTokensIncomplete(payload);

    attemptsDebug.push({
      attempt: attempt + 1,
      maxOutputTokens,
      status: payload && payload.status ? payload.status : "",
      incompleteReason: payload && payload.incomplete_details ? payload.incomplete_details.reason : "",
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
        openaiResponse: payload,
        attempts: attemptsDebug
      };
      throw err;
    }

    return {
      profileJson: normalizeProfileJsonShape(parsed),
      debug: {
        rawText,
        cleanedText,
        openaiResponse: payload,
        attempts: attemptsDebug
      }
    };
  }

  const err = new Error("Nao foi possivel obter JSON completo apos as tentativas de retry.");
  err.statusCode = 422;
  err.debug = { attempts: attemptsDebug };
  throw err;
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

async function reviseTextWithAi({
  text,
  html = "",
  prompt = "Revise o texto abaixo sem mudar muitas palavras",
  systemInstruction = null,
  preserveFormatting = false,
  maxOutputTokens = null
}) {
  if (!env.openai.apiKey) {
    const err = new Error("OPENAI_API_KEY nao configurada no ambiente.");
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
    ? Math.min(maxOutputTokens, env.openai.maxOutputTokensCap)
    : Math.min(1200, env.openai.maxOutputTokensCap);

  let body;
  if (systemInstruction) {
    // Modo traducao: instrucao no system message, apenas o texto na mensagem de usuario
    body = {
      model: env.openai.model,
      temperature: 0.2,
      max_output_tokens: tokenCap,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: String(systemInstruction).trim() }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: sourceText }]
        }
      ]
    };
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
    body = {
      model: env.openai.model,
      temperature: 0.2,
      max_output_tokens: tokenCap,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "Voce revisa textos tecnicos em portugues mantendo o sentido e alterando o minimo possivel."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `${instruction}\n\n${reviewTarget}\n\n${outputInstruction}`
            }
          ]
        }
      ]
    };
  }

  const payload = await callOpenAiResponsesApi(body);
  const revised = stripJsonCodeFence(extractOutputText(payload)).trim();
  if (!revised) {
    const err = new Error("A IA nao retornou texto revisado.");
    err.statusCode = 422;
    err.debug = { openaiResponse: payload };
    throw err;
  }

  if (!systemInstruction && Boolean(preserveFormatting)) {
    return {
      revisedHtml: revised,
      revisedText: revised,
      debug: { openaiResponse: payload }
    };
  }

  return {
    revisedText: revised,
    debug: { openaiResponse: payload }
  };
}

module.exports = {
  generateProfileJsonFromDocument,
  buildProfileAiPrompt,
  reviseTextWithAi
};
