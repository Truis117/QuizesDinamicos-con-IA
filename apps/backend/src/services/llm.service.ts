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
      const servedQuestions = cachedQuestions
        .slice(0, count)
        .map((question) => this.randomizeQuestionOptions(question));

      for (const question of servedQuestions) {
        await onQuestion(question);
      }

      return {
        output: { questions: servedQuestions },
        model: env.OPENROUTER_MODEL_PRIMARY,
        provider: "openrouter",
        latencyMs: 0,
        firstQuestionLatencyMs: 0,
        fromCache: true
      };
    }

    if (!env.OPENROUTER_API_KEY) {
      const fallbackQuestions = this.buildFallbackQuestions(topic, difficulty, count).map((question) =>
        this.randomizeQuestionOptions(question)
      );
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
      `Genera exactamente ${count} preguntas de opcion multiple sobre \"${topic}\".`,
      `Dificultad: ${difficulty}.`,
      "Formato de salida obligatorio: NDJSON (un objeto JSON valido por linea).",
      "No uses markdown, no devuelvas arrays y no agregues texto adicional.",
      "Todo el contenido visible para el usuario debe estar en espanol: questionText, options A/B/C/D, explanation y subtopic.",
      "Si el tema llega en otro idioma, conserva el significado pero escribe la salida en espanol.",
      "Distribuye la respuesta correcta entre A, B, C y D de forma equilibrada; no uses siempre la opcion A.",
      "Evita palabras en ingles salvo nombres propios o terminos tecnicos inevitables.",
      "Cada linea debe seguir este esquema JSON:",
      '{"questionText":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correctOption":"A","explanation":"...","subtopic":"..."}'
    ].join("\n");

    const body = {
      model: env.OPENROUTER_MODEL_PRIMARY,
      messages: [
        {
          role: "system",
          content:
            "Eres un motor de generacion de quizzes. Siempre produces NDJSON estricto con un objeto JSON valido por linea. Debes escribir en espanol la pregunta, opciones, explicacion y subtema."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.2,
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

        const randomizedQuestion = this.randomizeQuestionOptions(question);
        emitted.push(randomizedQuestion);

        if (firstQuestionLatencyMs === undefined) {
          firstQuestionLatencyMs = Date.now() - startTime;
        }

        await onQuestion(randomizedQuestion);
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

      if (emitted.length < count) {
        const fallbackQuestions = this.buildFallbackQuestions(
          topic,
          difficulty,
          count - emitted.length,
          emitted.length + 1
        );

        for (const question of fallbackQuestions) {
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
        const servedQuestions = staleCache
          .slice(0, count)
          .map((question) => this.randomizeQuestionOptions(question));

        for (const question of servedQuestions) {
          await onQuestion(question);
        }

        return {
          output: { questions: servedQuestions },
          model: env.OPENROUTER_MODEL_PRIMARY,
          provider: "openrouter",
          latencyMs: Date.now() - startTime,
          fromCache: true
        };
      }

      const fallbackQuestions = this.buildFallbackQuestions(topic, difficulty, count).map((question) =>
        this.randomizeQuestionOptions(question)
      );
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
    return `${normalizedTopic}::${difficulty}::${count}::es-v1`;
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
      if (!this.isSpanishQuestion(validated.data)) return null;
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
        return asLlmOutput.data.questions.filter((question) => this.isSpanishQuestion(question));
      }

      const asQuestionArray = LlmQuestionSchema.array().safeParse(asObject);
      if (asQuestionArray.success) {
        return asQuestionArray.data.filter((question) => this.isSpanishQuestion(question));
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
    const optionValues = [
      question.options.A,
      question.options.B,
      question.options.C,
      question.options.D
    ]
      .map((value) => value.trim().toLowerCase())
      .sort()
      .join("|");

    return `${question.questionText.trim().toLowerCase()}::${optionValues}`;
  }

  private randomizeQuestionOptions(question: LlmQuestion): LlmQuestion {
    const optionSlots = ["A", "B", "C", "D"] as const;
    const shuffled = optionSlots.map((key) => ({ key, text: question.options[key] }));

    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const remappedOptions = {
      A: shuffled[0].text,
      B: shuffled[1].text,
      C: shuffled[2].text,
      D: shuffled[3].text
    };

    const remappedIndex = shuffled.findIndex((entry) => entry.key === question.correctOption);
    const remappedCorrectOption = remappedIndex >= 0 ? optionSlots[remappedIndex] : question.correctOption;

    return {
      ...question,
      options: remappedOptions,
      correctOption: remappedCorrectOption
    };
  }

  private isSpanishQuestion(question: LlmQuestion): boolean {
    const text = [
      question.questionText,
      question.options.A,
      question.options.B,
      question.options.C,
      question.options.D,
      question.explanation,
      question.subtopic
    ].join(" ");

    return this.isLikelySpanish(text);
  }

  private isLikelySpanish(text: string): boolean {
    const words = text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);

    const englishMarkers = new Set([
      "the",
      "which",
      "what",
      "is",
      "are",
      "and",
      "or",
      "with",
      "about",
      "correct",
      "incorrect",
      "because",
      "best",
      "option",
      "question",
      "statement",
      "true",
      "false",
      "answer"
    ]);

    const spanishMarkers = new Set([
      "el",
      "la",
      "los",
      "las",
      "que",
      "cual",
      "es",
      "son",
      "y",
      "o",
      "con",
      "sobre",
      "correcta",
      "incorrecta",
      "porque",
      "mejor",
      "opcion",
      "pregunta",
      "afirmacion",
      "verdadero",
      "falso",
      "respuesta"
    ]);

    let englishCount = 0;
    let spanishCount = 0;

    for (const word of words) {
      if (englishMarkers.has(word)) englishCount += 1;
      if (spanishMarkers.has(word)) spanishCount += 1;
    }

    if (englishCount === 0) return true;
    return spanishCount >= englishCount;
  }

  private buildFallbackQuestions(
    topic: string,
    difficulty: Difficulty,
    count: number,
    startIndex = 1
  ): LlmQuestion[] {
    const levels: Record<Difficulty, string> = {
      EASY: "introductorio",
      MEDIUM: "intermedio",
      HARD: "avanzado"
    };

    const base = Array.from({ length: count }, (_, index) => {
      const n = startIndex + index;
      return {
        questionText: `(${levels[difficulty]}) ${topic}: ?Que afirmacion resume mejor el concepto ${n}?`,
        options: {
          A: `Una explicacion concisa y precisa del concepto ${n} de ${topic}.`,
          B: `Una descripcion parcialmente correcta que omite contexto clave del concepto ${n}.`,
          C: `Una afirmacion no relacionada que no aplica a ${topic}.`,
          D: `Una confusion comun sobre el concepto ${n} de ${topic}.`
        },
        correctOption: "A" as const,
        explanation:
          "La opcion A ofrece la respuesta mas completa y precisa. Las demas opciones son incompletas, se alejan del tema o reflejan ideas equivocadas.",
        subtopic: `Concepto central ${n}`
      };
    });

    return base;
  }
}
