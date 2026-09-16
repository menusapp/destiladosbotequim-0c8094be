/**
 * Cliente de IA compartilhado — substitui o AI Gateway do Lovable.
 *
 * Antes, três functions (`digitize-menu`, `digitize-menu-url` e
 * `fiscal-ai-suggest`) chamavam `https://ai.gateway.lovable.dev` usando a
 * `LOVABLE_API_KEY`. Isso só funciona enquanto o projeto vive no Lovable.
 *
 * Aqui a chamada é feita direto num endpoint compatível com a API da OpenAI.
 * O padrão é o Google Gemini (que expõe uma camada compatível), mas dá para
 * apontar para qualquer provedor compatível (OpenAI, OpenRouter, Groq, etc.)
 * só trocando as variáveis de ambiente — sem mexer em código.
 *
 * Secrets (Supabase → Project Settings → Edge Functions → Secrets):
 *
 *   AI_API_KEY    obrigatória. Também aceita GEMINI_API_KEY / OPENAI_API_KEY.
 *   AI_BASE_URL   opcional. Padrão: endpoint compatível do Gemini.
 *                 OpenAI     → https://api.openai.com/v1
 *                 OpenRouter → https://openrouter.ai/api/v1
 *   AI_MODEL_VISION  opcional. Modelo para leitura de imagem (foto do cardápio).
 *   AI_MODEL_TEXT    opcional. Modelo para tarefas de texto.
 */

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL_VISION = "gemini-2.5-flash";
const DEFAULT_MODEL_TEXT = "gemini-3-flash-preview";

export function getAiApiKey(): string | undefined {
  return (
    Deno.env.get("AI_API_KEY") ??
    Deno.env.get("GEMINI_API_KEY") ??
    Deno.env.get("OPENAI_API_KEY") ??
    undefined
  );
}

function getBaseUrl(): string {
  return (Deno.env.get("AI_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/**
 * Normaliza o nome do modelo para o provedor em uso.
 *
 * O gateway do Lovable usava nomes prefixados (`google/gemini-2.5-flash`).
 * A API nativa do Gemini não aceita esse prefixo, então ele é removido quando
 * o destino é o endpoint do Google. Em gateways que usam o prefixo
 * (OpenRouter, por exemplo) o nome passa intacto.
 */
function normalizeModel(model: string, baseUrl: string): string {
  if (baseUrl.includes("generativelanguage.googleapis.com")) {
    return model.replace(/^google\//, "");
  }
  return model;
}

export function visionModel(): string {
  return Deno.env.get("AI_MODEL_VISION") ?? DEFAULT_MODEL_VISION;
}

export function textModel(): string {
  return Deno.env.get("AI_MODEL_TEXT") ?? DEFAULT_MODEL_TEXT;
}

export type AiResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * Faz uma chamada de chat completion e já traduz os erros mais comuns para
 * mensagens em português, do jeito que as functions esperavam do gateway.
 */
export async function aiChatCompletion(
  payload: Record<string, unknown>,
): Promise<AiResult> {
  const apiKey = getAiApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      error:
        "Chave de IA não configurada. Defina o secret AI_API_KEY (ou GEMINI_API_KEY) nas Edge Functions.",
    };
  }

  const baseUrl = getBaseUrl();
  const model = normalizeModel(String(payload.model ?? textModel()), baseUrl);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...payload, model }),
    });
  } catch (err) {
    console.error("[ai] Falha de rede ao chamar o provedor:", err);
    return { ok: false, status: 502, error: "Não foi possível falar com o provedor de IA." };
  }

  if (!response.ok) {
    const body = await response.text();
    console.error("[ai] Erro do provedor:", response.status, body);
    if (response.status === 429) {
      return { ok: false, status: 429, error: "Limite de requisições excedido. Tente novamente em alguns segundos." };
    }
    if (response.status === 402) {
      return { ok: false, status: 402, error: "Créditos insuficientes no provedor de IA." };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: 500, error: "Chave de IA inválida ou sem permissão para este modelo." };
    }
    return { ok: false, status: 500, error: "Erro ao processar com IA" };
  }

  return { ok: true, data: await response.json() };
}

/** Extrai os argumentos do tool call, que é como as functions leem a resposta. */
export function extractToolArguments(data: Record<string, unknown>): string | undefined {
  const choices = data?.choices as Array<Record<string, any>> | undefined;
  return choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
}
