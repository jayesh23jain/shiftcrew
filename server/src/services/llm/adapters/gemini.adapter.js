/**
 * Native Google Gemini REST adapter using generateContent.
 */
export async function completeGemini({
  system,
  messages = [],
  schema,
  tools,
  maxTokens = 2048,
  temperature = 0.2,
  model,
  apiKey,
  baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  timeoutMs = 25000,
}) {
  const root = baseUrl.replace(/\/+$/, '');
  const url = `${root}/models/${model}:generateContent?key=${apiKey}`;

  const contents = messages.map((m) => {
    let role = m.role === 'assistant' ? 'model' : 'user';
    if (m.role === 'tool') {
      role = 'user';
      return {
        role,
        parts: [{ text: `[Tool Output for ${m.name || 'tool'}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}` }],
      };
    }
    return {
      role,
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
    };
  });

  const payload = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  };

  if (system) {
    payload.system_instruction = {
      parts: [{ text: system }],
    };
  }

  if (schema) {
    payload.generationConfig.responseMimeType = 'application/json';
  }

  if (tools && tools.length > 0) {
    payload.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.function ? t.function.name : t.name,
          description: t.function ? t.function.description : t.description,
          parameters: t.function ? t.function.parameters : t.parameters,
        })),
      },
    ];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errorBody = '';
      try {
        errorBody = await res.text();
      } catch {
        errorBody = res.statusText;
      }
      const err = new Error(`Gemini request failed (${res.status}): ${errorBody}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    let content = '';
    const toolCalls = [];

    for (const part of parts) {
      if (part.text) content += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${part.functionCall.name}_${Date.now()}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {}),
          },
        });
      }
    }

    const usage = {
      promptTokens: data.usageMetadata?.promptTokenCount || 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: data.usageMetadata?.totalTokenCount || 0,
    };

    return { content, toolCalls, usage };
  } finally {
    clearTimeout(timer);
  }
}
