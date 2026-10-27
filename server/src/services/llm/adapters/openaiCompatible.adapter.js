/**
 * Adapter for OpenAI-compatible endpoints:
 * Groq, Ollama, OpenRouter, and Gemini OpenAI-compatible endpoint.
 */
export async function completeOpenAICompatible({
  system,
  messages = [],
  schema,
  tools,
  maxTokens = 2048,
  temperature = 0.2,
  model,
  apiKey,
  baseUrl = 'https://api.groq.com/openai/v1',
  timeoutMs = 25000,
}) {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const formattedMessages = [];
  if (system) {
    formattedMessages.push({ role: 'system', content: system });
  }
  for (const m of messages) {
    const formatted = {
      role: m.role || 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    };
    if (m.tool_call_id) formatted.tool_call_id = m.tool_call_id;
    if (m.name) formatted.name = m.name;
    if (m.tool_calls) formatted.tool_calls = m.tool_calls;
    formattedMessages.push(formatted);
  }

  const payload = {
    model,
    messages: formattedMessages,
    max_tokens: maxTokens,
    temperature,
  };

  if (schema) {
    payload.response_format = { type: 'json_object' };
  }

  if (tools && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }

  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
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
      const err = new Error(`OpenAI-compatible request failed (${res.status}): ${errorBody}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const message = data.choices?.[0]?.message;
    const content = message?.content || '';
    let toolCalls = (message?.tool_calls || []).map((tc) => ({
      id: tc.id,
      type: tc.type || 'function',
      function: {
        name: tc.function?.name,
        arguments: tc.function?.arguments || '{}',
      },
    }));

    if (!toolCalls.length && content.includes('<tool_call>')) {
      const match = content.match(/<function=([a-zA-Z0-9_]+)>([\s\S]*?)<\/function>/i);
      if (match) {
        const fnName = match[1];
        let args = '{}';
        const rawArgs = match[2].trim();
        if (rawArgs.startsWith('{') && rawArgs.endsWith('}')) {
          args = rawArgs;
        }
        toolCalls.push({
          id: `call_${fnName}_${Date.now()}`,
          type: 'function',
          function: { name: fnName, arguments: args },
        });
      }
    }

    const usage = {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
    };

    return { content, toolCalls, usage };
  } finally {
    clearTimeout(timer);
  }
}
