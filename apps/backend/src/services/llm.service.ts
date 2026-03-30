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
  generationAttempts: number;
};

const GENERIC_PATTERNS = [
  /concepto\s*\d+/i,
  /afirmacion\s*(resume|mejor|describe)/i,
  /^option\s*[a-d]/i,
  /^pregunta\s*\d+/i,
  /^question\s*\d+/i,
  /statement\s*\d+/i,
  /^p\d+/i,
  /^\([a-z]+\)\s+\w+:/i,
  /una\s+(explicacion|descripcion|afirmacion|confusion)\s+(concisa|parcial|comun)\s+(del?\s+)?concepto/i,
  /^a\)\s*una\s+(explicacion|descripcion)/i,
  /^b\)\s*una\s+(explicacion|descripcion)/i,
  /^c\)\s*una\s+(explicacion|descripcion)/i,
  /^d\)\s*una\s+(explicacion|descripcion)/i
];

export class LlmService {
  private static generationCache = new Map<string, CacheEntry>();
  private static readonly cacheMaxEntries = 100;
  private static readonly cachePruneBatch = 20;
  private static readonly openRouterTimeoutMs = 60_000;
  private static readonly maxRetries = 2;

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
        fromCache: true,
        generationAttempts: 0
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
        fromCache: false,
        generationAttempts: 0
      };
    }

    let allEmitted: LlmQuestion[] = [];
    let generationAttempts = 0;
    let currentModel = env.OPENROUTER_MODEL_PRIMARY;
    let lastError: Error | null = null;

    const tryGenerateWithModel = async (
      model: string,
      attemptTopic: string,
      attemptDifficulty: Difficulty,
      attemptCount: number
    ): Promise<LlmQuestion[]> => {
      generationAttempts++;
      const result = await this.generateWithModel(
        model,
        attemptTopic,
        attemptDifficulty,
        attemptCount,
        onQuestion
      );
      return result;
    };

    try {
      allEmitted = await tryGenerateWithModel(
        env.OPENROUTER_MODEL_PRIMARY,
        topic,
        difficulty,
        count
      );

      if (allEmitted.length < count && env.OPENROUTER_MODEL_FALLBACK) {
        logger.warn(
          { topic, primaryCount: allEmitted.length, needed: count },
          "Primary model insufficient, trying fallback"
        );
        const missing = count - allEmitted.length;
        const fallbackQuestions = await tryGenerateWithModel(
          env.OPENROUTER_MODEL_FALLBACK,
          topic,
          difficulty,
          missing
        );
        allEmitted = [...allEmitted, ...fallbackQuestions];
        currentModel = `${env.OPENROUTER_MODEL_PRIMARY} + ${env.OPENROUTER_MODEL_FALLBACK}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.error({ err: lastError, topic, difficulty, count }, "LLM generation failed");
    }

    if (allEmitted.length === 0) {
      throw new Error(
        lastError?.message || "No se pudieron generar preguntas de calidad. Por favor intenta de nuevo."
      );
    }

    const finalQuestions = allEmitted.slice(0, count);
    LlmService.generationCache.set(cacheKey, {
      createdAt: Date.now(),
      questions: finalQuestions
    });
    this.pruneGenerationCache();

    return {
      output: { questions: finalQuestions },
      model: currentModel,
      provider: "openrouter",
      latencyMs: 0,
      firstQuestionLatencyMs: 0,
      fromCache: false,
      generationAttempts
    };
  }

  private async generateWithModel(
    model: string,
    topic: string,
    difficulty: Difficulty,
    count: number,
    onQuestion: (question: LlmQuestion) => Promise<void>
  ): Promise<LlmQuestion[]> {
    const prompt = this.buildQualityPrompt(topic, difficulty, count);

    const body = {
      model,
      messages: [
        {
          role: "system",
          content: this.buildSystemPrompt()
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      stream: true
    };

    const startTime = Date.now();
    let firstQuestionLatencyMs: number | undefined;

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

    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    const emitted: LlmQuestion[] = [];
    const emittedSignatures = new Set<string>();

    const emitQuestion = async (question: LlmQuestion) => {
      if (!this.isQualityQuestion(question)) {
        logger.warn({ question: question.questionText }, "Question failed quality gate");
        return;
      }

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

    return emitted;
  }

  private buildSystemPrompt(): string {
    return `Eres un experto en crear preguntas de opción multiple de alta calidad para quizzes educativos.

Tu objetivo es generar preguntas que:
1. Sean precisas, claras y evalúen conocimiento real
2. Tengas distractores (opciones incorrectas) plausibles y dentro del mismo dominio temático
3. La explicación sea específica, indicando por qué la respuesta correcta es correcta Y por qué cada distractora es incorrecta
4. Uses lenguaje natural y directo, no frases plantilla

Ejemplo de pregunta BUENA:
{
  "questionText": "¿Cuál es la capital de Francia?",
  "options": {
    "A": "París",
    "B": "Londres",
    "C": "Berlín",
    "D": "Madrid"
  },
  "correctOption": "A",
  "explanation": "París es la capital de Francia desde el siglo X. Las otras opciones son capitales de otros países europeos: Londres (Reino Unido), Berlín (Alemania) y Madrid (España).",
  "subtopic": "geografía europea"
}

Ejemplo de pregunta MALA (NO GENERES ESTO):
{
  "questionText": "concepto 1",
  "options": {
    "A": "una explicación concisa del concepto 1",
    "B": "una descripción parcialmente correcta del concepto 1",
    "C": "una afirmación no relacionada",
    "D": "una confusión común"
  },
  "correctOption": "A",
  "explanation": "La opción A es correcta porque sí.",
  "subtopic": "general"
}

IMPORTANTE: 
- NUNCA uses patrones como "concepto N", "afirmación resume mejor", "opción A/B/C/D" en las opciones
- Cada pregunta debe ser sobre un aspecto específico y concreto del tema
- Los distractores deben ser respuestas que alguien con conocimiento parcial podría elegir plausiblemente
- Toda la salida debe ser en español
- Formato de salida: NDJSON (un objeto JSON válido por línea, SIN markdown)`;
  }

  private buildQualityPrompt(topic: string, difficulty: Difficulty, count: number): string {
    const difficultyText: Record<Difficulty, string> = {
      EASY: "básico - conceptos fundamentales, definiciones, datos concretos",
      MEDIUM: "intermedio - aplicación de conceptos, relaciones entre ideas",
      HARD: "avanzado - análisis crítico, resolución de problemas complejos"
    };

    return `Genera exactamente ${count} preguntas de opción multiple sobre "${topic}".

DIFICULTAD: ${difficultyText[difficulty]}

REGLAS OBLIGATORIAS:
1. Cada pregunta debe evaluar un aspecto CONCRETO y ESPECÍFICO del tema "${topic}"
2. Las opciones incorrectas (distractores) deben ser plausibles - respuestas que alguien con conocimiento parcial podría elegir
3. La explicación debe ser detallada: explica por qué la correcta es correcta Y por qué cada distractora es incorrecta
4. NO uses frases plantilla como "concepto 1", "afirmación resume mejor", etc.
5. NO repitas el texto del tema en cada opción (ej: no pongas "${topic}" en todas las opciones)
6. El subtopic debe ser un aspecto específico, no genérico

FORMATO: NDJSON - un objeto JSON válido por línea, sin markdown, sin arrays, sin texto adicional.

Ejemplo de formato exacto:
{"questionText":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correctOption":"A","explanation":"...","subtopic":"..."}`;
  }

  private buildCacheKey(topic: string, difficulty: Difficulty, count: number): string {
    const normalizedTopic = topic.trim().toLowerCase().replace(/\s+/g, " ");
    return `${normalizedTopic}::${difficulty}::${count}::es-v2-quality`;
  }

  private pruneGenerationCache() {
    const cache = LlmService.generationCache;
    if (cache.size <= LlmService.cacheMaxEntries) return;

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
        return asLlmOutput.data.questions.filter(
          (question) => this.isSpanishQuestion(question) && this.isQualityQuestion(question)
        );
      }

      const asQuestionArray = LlmQuestionSchema.array().safeParse(asObject);
      if (asQuestionArray.success) {
        return asQuestionArray.data.filter(
          (question) => this.isSpanishQuestion(question) && this.isQualityQuestion(question)
        );
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

  private isQualityQuestion(question: LlmQuestion): boolean {
    const fullText = [
      question.questionText,
      question.options.A,
      question.options.B,
      question.options.C,
      question.options.D,
      question.explanation
    ].join(" ").toLowerCase();

    for (const pattern of GENERIC_PATTERNS) {
      if (pattern.test(fullText)) {
        return false;
      }
    }

    const minQuestionLength = 15;
    if (question.questionText.length < minQuestionLength) {
      return false;
    }

    const minOptionLength = 5;
    const optionsText = [question.options.A, question.options.B, question.options.C, question.options.D].join(" ");
    if (optionsText.length < minOptionLength * 4) {
      return false;
    }

    const uniqueOptions = new Set([
      question.options.A,
      question.options.B,
      question.options.C,
      question.options.D
    ].map((o) => o.toLowerCase().trim()));

    if (uniqueOptions.size < 4) {
      return false;
    }

    return true;
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
        questionText: `(${levels[difficulty]}) Pregunta de ejemplo ${n} sobre ${topic}`,
        options: {
          A: `Respuesta correcta de ejemplo para ${topic}`,
          B: `Distractor plausible incorrecto sobre ${topic}`,
          C: `Otra opción incorrecta relacionada con ${topic}`,
          D: `Opción claramente incorrecta sobre ${topic}`
        },
        correctOption: "A" as const,
        explanation: `Esta es una pregunta de ejemplo. En una implementación real, el modelo LLM debería generar contenido específico sobre ${topic}.`,
        subtopic: `ejemplo ${n}`
      };
    });

    return base;
  }
}
