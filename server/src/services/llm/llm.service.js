import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../../utils/audit.js';
import { mockAdapter } from './adapters/mock.adapter.js';
import { completeOpenAICompatible } from './adapters/openaiCompatible.adapter.js';
import { completeGemini } from './adapters/gemini.adapter.js';

class LlmService {
  constructor() {
    this.cache = new Map();
    this.cacheTtlMs = 30 * 60 * 1000; // 30 minutes cache
    this.requestTimestamps = [];
    this.queue = [];
    this.processingQueue = false;

    // Daily budget tracker
    this.dailyTokensUsed = 0;
    this.currentDateStr = new Date().toISOString().slice(0, 10);
  }

  resetState() {
    this.cache.clear();
    this.requestTimestamps = [];
    this.queue = [];
    this.processingQueue = false;
    this.dailyTokensUsed = 0;
    this.currentDateStr = new Date().toISOString().slice(0, 10);
    mockAdapter.reset();
  }

  getAiStatus() {
    return {
      enabled: Boolean(env.LLM_ENABLED),
      provider: env.LLM_PROVIDER,
      canUseUserData: Boolean(env.LLM_ALLOW_USER_DATA),
    };
  }

  _checkAndTrackBudget(tokensToAdd = 0) {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDateStr) {
      this.currentDateStr = today;
      this.dailyTokensUsed = 0;
    }

    if (this.dailyTokensUsed + tokensToAdd > env.LLM_DAILY_TOKEN_BUDGET) {
      throw ApiError.tooManyRequests(
        'AI daily token budget reached. Please try again tomorrow or use the manual option.'
      );
    }
    this.dailyTokensUsed += tokensToAdd;
  }

  _hashRequest(payload) {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  /**
   * Global queue and project-wide limiter adhering to LLM_GLOBAL_RPM
   */
  async _acquireQueueSlot(timeoutMs = 20000) {
    const maxRpm = Math.max(1, Number(env.LLM_GLOBAL_RPM) || 10);
    const windowMs = 60 * 1000;

    return new Promise((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this._removeFromQueue(entry);
          reject(
            ApiError.tooManyRequests(
              'AI is busy, try again in a minute or use the manual option.'
            )
          );
        }, timeoutMs),
      };

      if (this.queue.length >= 25) {
        clearTimeout(entry.timer);
        return reject(
          ApiError.tooManyRequests(
            'AI is busy, try again in a minute or use the manual option.'
          )
        );
      }

      this.queue.push(entry);
      this._drainQueue(maxRpm, windowMs);
    });
  }

  _removeFromQueue(entry) {
    const idx = this.queue.indexOf(entry);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
    }
  }

  _drainQueue(maxRpm, windowMs) {
    if (this.processingQueue) return;
    this.processingQueue = true;

    const process = () => {
      const now = Date.now();
      // Purge timestamps older than 60s
      this.requestTimestamps = this.requestTimestamps.filter((t) => t > now - windowMs);

      while (this.queue.length > 0 && this.requestTimestamps.length < maxRpm) {
        const next = this.queue.shift();
        clearTimeout(next.timer);
        this.requestTimestamps.push(now);
        next.resolve();
      }

      if (this.queue.length > 0) {
        const oldest = this.requestTimestamps[0] || now;
        const delay = Math.max(100, oldest + windowMs - now + 50);
        setTimeout(process, delay);
      } else {
        this.processingQueue = false;
      }
    };

    process();
  }

  /**
   * Call a specific adapter with credentials
   */
  async _callAdapter({ provider, model, apiKey, baseUrl, system, messages, schema, tools, maxTokens, temperature }) {
    if (provider === 'mock') {
      return mockAdapter.complete({ system, messages, schema, tools, maxTokens, temperature, model });
    }

    if (provider === 'openai-compatible') {
      return completeOpenAICompatible({
        system,
        messages,
        schema,
        maxTokens,
        temperature,
        model,
        apiKey,
        baseUrl,
      });
    }

    if (provider === 'gemini') {
      return completeGemini({
        system,
        messages,
        schema,
        maxTokens,
        temperature,
        model,
        apiKey,
        baseUrl,
      });
    }

    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  /**
   * Unified complete() with queue, rate limits, caching, fallback, and backoff
   */
  async complete({
    system,
    messages = [],
    schema,
    tools,
    maxTokens = 2048,
    temperature = 0.2,
    feature = 'plan-event',
    actor,
  }) {
    if (!env.LLM_ENABLED) {
      throw ApiError.badRequest('AI features are currently disabled in settings.');
    }

    // Check daily budget limit before queuing
    this._checkAndTrackBudget(0);

    // Normalize request for hash & cache
    const normalized = {
      system: system || '',
      messages: messages.map((m) => ({ role: m.role, content: m.content, name: m.name, tool_call_id: m.tool_call_id })),
      tools: tools || [],
      maxTokens,
      temperature,
    };
    const inputHash = this._hashRequest(normalized);

    // Cache check
    const cached = this.cache.get(inputHash);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return {
        content: cached.content,
        toolCalls: cached.toolCalls || [],
        usage: cached.usage,
        fromCache: true,
      };
    }

    // Acquire rate-limited slot in global queue
    await this._acquireQueueSlot();

    const startTime = Date.now();
    let response;
    let usedProvider = env.LLM_PROVIDER;
    let usedModel = env.LLM_MODEL;

    try {
      // Primary attempt with 1 retry on 429/5xx after exponential backoff
      try {
        response = await this._callAdapter({
          provider: env.LLM_PROVIDER,
          model: env.LLM_MODEL,
          apiKey: env.LLM_API_KEY,
          baseUrl: env.LLM_BASE_URL,
          system,
          messages,
          schema,
          tools,
          maxTokens,
          temperature,
        });
      } catch (primaryErr) {
        const isTransient =
          primaryErr.status === 429 ||
          (primaryErr.status >= 500 && primaryErr.status <= 599) ||
          primaryErr.name === 'AbortError' ||
          primaryErr.code === 'ECONNRESET';

        if (isTransient) {
          // Exponential backoff wait (e.g. 500ms)
          await new Promise((r) => setTimeout(r, 500));
          try {
            response = await this._callAdapter({
              provider: env.LLM_PROVIDER,
              model: env.LLM_MODEL,
              apiKey: env.LLM_API_KEY,
              baseUrl: env.LLM_BASE_URL,
              system,
              messages,
              schema,
              tools,
              maxTokens,
              temperature,
            });
          } catch (retryErr) {
            // Re-throw to trigger fallback
            throw retryErr;
          }
        } else {
          throw primaryErr;
        }
      }
    } catch (primaryFailure) {
      const canFallback =
        env.LLM_FALLBACK_PROVIDER &&
        (primaryFailure.status === 429 ||
          (primaryFailure.status >= 500 && primaryFailure.status <= 599) ||
          primaryFailure.name === 'AbortError');

      if (canFallback) {
        usedProvider = env.LLM_FALLBACK_PROVIDER;
        usedModel = env.LLM_FALLBACK_MODEL;
        try {
          response = await this._callAdapter({
            provider: env.LLM_FALLBACK_PROVIDER,
            model: env.LLM_FALLBACK_MODEL,
            apiKey: env.LLM_FALLBACK_API_KEY,
            baseUrl: env.LLM_FALLBACK_BASE_URL,
            system,
            messages,
            schema,
            tools,
            maxTokens,
            temperature,
          });
        } catch (fallbackErr) {
          console.error('LLM fallback also failed:', fallbackErr.message);
          throw ApiError.tooManyRequests(
            'AI is busy, try again in a minute or use the manual option.'
          );
        }
      } else {
        if (primaryFailure.status === 429) {
          throw ApiError.tooManyRequests(
            'AI is busy, try again in a minute or use the manual option.'
          );
        }
        throw ApiError.internal(
          'AI service is currently unavailable. Please use the manual option or try again later.'
        );
      }
    }

    const latencyMs = Date.now() - startTime;
    const usage = response.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // Record token usage against daily budget
    this._checkAndTrackBudget(usage.totalTokens || 0);

    // Save to cache
    this.cache.set(inputHash, {
      content: response.content,
      toolCalls: response.toolCalls || [],
      usage,
      timestamp: Date.now(),
    });

    // Usage logging: feature, provider, model, tokens, latency, inputHash (NEVER raw content)
    await audit(actor, 'ai.usage', {
      entityType: 'AiUsage',
      meta: {
        feature,
        provider: usedProvider,
        model: usedModel,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        latencyMs,
        inputHash,
      },
    });

    return {
      content: response.content,
      toolCalls: response.toolCalls || [],
      usage,
      fromCache: false,
    };
  }

  /**
   * Zod-validated structured output with one retry on invalid JSON, then clean failure.
   */
  async completeStructured({
    system,
    messages = [],
    schema,
    maxTokens = 2048,
    temperature = 0.2,
    feature = 'plan-event',
    actor,
  }) {
    const parseCandidate = (rawText) => {
      let cleaned = rawText.trim();
      // Remove markdown code fences if model returned ```json ... ```
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
      }
      return JSON.parse(cleaned);
    };

    // First attempt
    const firstRes = await this.complete({
      system,
      messages,
      schema,
      maxTokens,
      temperature,
      feature,
      actor,
    });

    try {
      const parsed = parseCandidate(firstRes.content);
      const validated = schema ? schema.parse(parsed) : parsed;
      return { data: validated, fromCache: firstRes.fromCache };
    } catch (parseErr) {
      console.warn('AI structured output parsing failed, initiating 1 retry:', parseErr.message);

      // 1 Retry with explicit schema correction
      const retryMessages = [
        ...messages,
        { role: 'assistant', content: firstRes.content },
        {
          role: 'user',
          content: `Your previous response was not valid JSON conforming to the schema. Parse error: ${parseErr.message}. Please respond with ONLY valid JSON strictly adhering to the schema, with no additional text or Markdown blocks.`,
        },
      ];

      const retryRes = await this.complete({
        system,
        messages: retryMessages,
        schema,
        maxTokens,
        temperature,
        feature,
        actor,
      });

      try {
        const parsed = parseCandidate(retryRes.content);
        const validated = schema ? schema.parse(parsed) : parsed;
        return { data: validated, fromCache: retryRes.fromCache };
      } catch (finalErr) {
        console.error('AI retry also failed structured parsing:', finalErr.message);
        throw ApiError.badRequest(
          'AI failed to generate a valid plan. Please try again or use the manual option.'
        );
      }
    }
  }
}

export const llmService = new LlmService();
