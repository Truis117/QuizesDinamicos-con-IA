import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import {
  Difficulty,
  LlmOutput,
  LlmOutputSchema,
  LlmQuestion,
  LlmQuestionSchema
} from "@quiz/contracts";

type CacheEntry = {
  createdAt: number;
  questions: LlmQuestion[];
};

type OpenRouterChunk = {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices?: Array<{
    delta?: {
      content?: string;
    };
    message?: {
      content?: string;
    };
    finish_reason?: string | null;
  }>;
};

export type GenerateQuestionsResult = {
  output: LlmOutput;
  model: string;
  provider: string;
  latencyMs: number;
  firstQuestionLatencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  fromCache: boolean;
};

export class LlmService {
  private static generationCache = new Map<string, CacheEntry>();
  private static readonly cacheMaxEntries = 100;
  private static readonly cachePruneBatch = 20;
  private static readonly openRouterTimeoutMs = 60_000;

  private get cacheTtlMs() {
    return env.LLM_CACHE_TTL_SEC * 1000;
  }

  getCachedQuestions(
    topic: string,
    difficulty: Difficulty,
    count: number,
    allowStale = false
  ): LlmQuestion[] | null {
    const key = this.buildCacheKey(topic, difficulty, count);
    const entry = LlmService.generationCache.get(key);
    if (!entry) return null;

    const ageMs = Date.now() - entry.createdAt;
    if (!allowStale && ageMs > this.cacheTtlMs) return null;

    return entry.questions.slice(0, count);
  }

  async generateQuestionsStream(
    topic: string,
    difficulty: Difficulty,
    count: number,
    onQuestion: (question: LlmQuestion) => Promise<void>
  ): Promise<GenerateQuestionsResult> {
    const cacheKey = this.buildCacheKey(topic, difficulty, count);
    const cachedQuestions = this.getCachedQuestions(topic, difficulty, count);
    if (cachedQuestions && cachedQuestions.length >= count) {
      for (const question of cachedQuestions.slice(0, count)) {
        await onQuestion(question);
      }

      return {
        output: { questions: cachedQuestions.slice(0, count) },
        model: env.OPENROUTER_MODEL_PRIMARY,
        provider: "openrouter",
        latencyMs: 0,
        firstQuestionLatencyMs: 0,
        fromCache: true
      };
    }

    if (!env.OPENROUTER_API_KEY) {
      const fallbackQuestions = this.buildFallbackQuestions(topic, difficulty, count);
      for (const question of fallbackQuestions) {
        await onQuestion(question);
      }

      LlmService.generationCache.set(cacheKey, {
        createdAt: Date.now(),
        questions: fallbackQuestions
      });
      this.pruneGenerationCache();

      return {
        output: { questions: fallbackQuestions },
        model: "fallback/local",
        provider: "local",
        latencyMs: 0,
        firstQuestionLatencyMs: 0,
        fromCache: false
      };
    }

    const prompt = [
      `Generate exactly ${count} multiple-choice questions about "${topic}".`,
      `Difficulty: ${difficulty}.`,
      "Output format must be NDJSON (one JSON object per line).",
      "Do not output markdown, arrays, or extra text.",
      "Each line must match this JSON schema:",
      '{"questionText":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correctOption":"A","explanation":"...","subtopic":"..."}'
    ].join("\n");

    const body = {
      model: env.OPENROUTER_MODEL_PRIMARY,
      messages: [
        {
          role: "system",
          content:
            "You are a quiz generation engine. You always produce strict NDJSON with one valid JSON object per line."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      stream: true
    };

    const startTime = Date.now();
    let firstQuestionLatencyMs: number | undefined;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, LlmService.openRouterTimeoutMs);

      let response: Response;
      try {
        response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": env.OPENROUTER_SITE_URL,
            "X-Title": env.OPENROUTER_SITE_NAME
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter error (${response.status}): ${errorText || response.statusText}`);
      }

      if (!response.body) {
        throw new Error("OpenRouter response stream is empty");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let sseBuffer = "";
      let contentBuffer = "";
      let fullContent = "";

      let model = env.OPENROUTER_MODEL_PRIMARY;
      let promptTokens: number | undefined;
      let completionTokens: number | undefined;

      const emitted: LlmQuestion[] = [];
      const emittedSignatures = new Set<string>();

      const emitQuestion = async (question: LlmQuestion) => {
        if (emitted.length >= count) return;

        const signature = this.questionSignature(question);
        if (emittedSignatures.has(signature)) return;

        emittedSignatures.add(signature);
        emitted.push(question);

        if (firstQuestionLatencyMs === undefined) {
          firstQuestionLatencyMs = Date.now() - startTime;
        }

        await onQuestion(question);
      };

      const drainNdjsonBuffer = async () => {
        while (true) {
          const newlineIndex = contentBuffer.indexOf("\n");
          if (newlineIndex === -1) break;

          const rawLine = contentBuffer.slice(0, newlineIndex);
          contentBuffer = contentBuffer.slice(newlineIndex + 1);

          const maybeQuestion = this.parseQuestionLine(rawLine);
          if (maybeQuestion) {
            await emitQuestion(maybeQuestion);
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const rawEvents = sseBuffer.split("\n\n");
        sseBuffer = rawEvents.pop() ?? "";

        for (const rawEvent of rawEvents) {
          const dataLines = rawEvent
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim());

          if (dataLines.length === 0) continue;

          const dataPayload = dataLines.join("\n");
          if (dataPayload === "[DONE]") continue;

          let parsedChunk: OpenRouterChunk;
          try {
            parsedChunk = JSON.parse(dataPayload) as OpenRouterChunk;
          } catch {
            continue;
          }

          if (parsedChunk.model) {
            model = parsedChunk.model;
          }

          if (parsedChunk.usage) {
            promptTokens = parsedChunk.usage.prompt_tokens;
            completionTokens = parsedChunk.usage.completion_tokens;
          }

          const textDelta =
            parsedChunk.choices?.[0]?.delta?.content ??
            parsedChunk.choices?.[0]?.message?.content ??
            "";

          if (!textDelta) continue;

          contentBuffer += textDelta;
          fullContent += textDelta;
          await drainNdjsonBuffer();
        }
      }

      const tailQuestion = this.parseQuestionLine(contentBuffer);
      if (tailQuestion) {
        await emitQuestion(tailQuestion);
      }

      if (emitted.length < count) {
        const recovered = this.recoverQuestions(fullContent);
        for (const question of recovered) {
          await emitQuestion(question);
          if (emitted.length >= count) break;
        }
      }

      if (emitted.length === 0) {
        throw new Error("No valid questions received from model stream");
      }

      const finalQuestions = emitted.slice(0, count);
      LlmService.generationCache.set(cacheKey, {
        createdAt: Date.now(),
        questions: finalQuestions
      });
      this.pruneGenerationCache();

      return {
        output: { questions: finalQuestions },
        model,
        provider: "openrouter",
        latencyMs: Date.now() - startTime,
        firstQuestionLatencyMs,
        promptTokens,
        completionTokens,
        fromCache: false
      };
    } catch (err) {
      logger.error({ err, topic, difficulty, count }, "LLM streaming generation failed");

      const staleCache = this.getCachedQuestions(topic, difficulty, count, true);
      if (staleCache && staleCache.length > 0) {
        for (const question of staleCache.slice(0, count)) {
          await onQuestion(question);
        }

        return {
          output: { questions: staleCache.slice(0, count) },
          model: env.OPENROUTER_MODEL_PRIMARY,
          provider: "openrouter",
          latencyMs: Date.now() - startTime,
          fromCache: true
        };
      }

      const fallbackQuestions = this.buildFallbackQuestions(topic, difficulty, count);
      for (const question of fallbackQuestions) {
        await onQuestion(question);
      }

      LlmService.generationCache.set(cacheKey, {
        createdAt: Date.now(),
        questions: fallbackQuestions
      });
      this.pruneGenerationCache();

      return {
        output: { questions: fallbackQuestions },
        model: "fallback/local",
        provider: "local",
        latencyMs: Date.now() - startTime,
        fromCache: false
      };
    }
  }

  private buildCacheKey(topic: string, difficulty: Difficulty, count: number): string {
    const normalizedTopic = topic.trim().toLowerCase().replace(/\s+/g, " ");
    return `${normalizedTopic}::${difficulty}::${count}`;
  }

  private pruneGenerationCache() {
    const cache = LlmService.generationCache;
    if (cache.size <= LlmService.cacheMaxEntries) {
      return;
    }

    const overflow = cache.size - LlmService.cacheMaxEntries;
    const pruneCount = Math.max(overflow, LlmService.cachePruneBatch);
    const keysToDelete = Array.from(cache.keys()).slice(0, pruneCount);
    for (const key of keysToDelete) {
      cache.delete(key);
    }
  }

  private parseQuestionLine(rawLine: string): LlmQuestion | null {
    const line = rawLine
      .trim()
      .replace(/^```json/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();

    if (!line) return null;
    if (line === "[" || line === "]") return null;

    const normalized = line.endsWith(",") ? line.slice(0, -1) : line;

    try {
      const parsed = JSON.parse(normalized);
      const validated = LlmQuestionSchema.safeParse(parsed);
      if (!validated.success) return null;
      return validated.data;
    } catch {
      return null;
    }
  }

  private recoverQuestions(content: string): LlmQuestion[] {
    const cleaned = content
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    if (!cleaned) return [];

    const recovered: LlmQuestion[] = [];

    try {
      const asObject = JSON.parse(cleaned);
      const asLlmOutput = LlmOutputSchema.safeParse(asObject);
      if (asLlmOutput.success) {
        return asLlmOutput.data.questions;
      }

      const asQuestionArray = LlmQuestionSchema.array().safeParse(asObject);
      if (asQuestionArray.success) {
        return asQuestionArray.data;
      }
    } catch {
      // Ignore and try line-based recovery below.
    }

    for (const line of cleaned.split(/\r?\n/)) {
      const question = this.parseQuestionLine(line);
      if (question) recovered.push(question);
    }

    return recovered;
  }

  private questionSignature(question: LlmQuestion): string {
    const options = `${question.options.A}|${question.options.B}|${question.options.C}|${question.options.D}`;
    return `${question.questionText.trim().toLowerCase()}::${options.trim().toLowerCase()}`;
  }

  private buildFallbackQuestions(
    topic: string,
    difficulty: Difficulty,
    count: number
  ): LlmQuestion[] {
    const levels: Record<Difficulty, string> = {
      EASY: "introductory",
      MEDIUM: "intermediate",
      HARD: "advanced"
    };

    const base = Array.from({ length: count }, (_, index) => {
      const n = index + 1;
      return {
        questionText: `(${levels[difficulty]}) ${topic}: Which statement best summarizes concept ${n}?`,
        options: {
          A: `A concise and accurate explanation of ${topic} concept ${n}.`,
          B: `A partially correct description missing key context for concept ${n}.`,
          C: `An unrelated claim that does not apply to ${topic}.`,
          D: `A common misconception about ${topic} concept ${n}.`
        },
        correctOption: "A" as const,
        explanation:
          "Option A gives the most complete and precise answer. The other options are incomplete, off-topic, or reflect misconceptions.",
        subtopic: `Core concept ${n}`
      };
    });

    return base;
  }
}
