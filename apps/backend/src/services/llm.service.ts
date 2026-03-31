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

type LlmChunk = {
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

type ProviderConfig = {
  url: string;
  headers: Record<string, string>;
  model: string;
  providerName: string;
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
  private static readonly llmTimeoutMs = 60_000;
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

    if (!env.OPENROUTER_API_KEY && !env.CEREBRAS_API_KEY) {
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
    let currentProvider = "openrouter";
    let lastError: Error | null = null;

    // ── Step 1: OpenRouter primary ─────────────────────────────────────────
    if (env.OPENROUTER_API_KEY && allEmitted.length < count) {
      try {
        generationAttempts++;
        logger.info({ topic, model: env.OPENROUTER_MODEL_PRIMARY }, "Trying OpenRouter primary");
        const questions = await this.generateWithProvider(
          this.openRouterConfig(env.OPENROUTER_MODEL_PRIMARY),
          topic,
          difficulty,
          count,
          onQuestion
        );
        allEmitted = [...allEmitted, ...questions];
        currentModel = env.OPENROUTER_MODEL_PRIMARY;
        currentProvider = "openrouter";
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn({ err: lastError, topic }, "OpenRouter primary failed");
      }
    }

    // ── Step 2: Cerebras (middle fallback) ────────────────────────────────
    if (env.CEREBRAS_API_KEY && allEmitted.length < count) {
      const missing = count - allEmitted.length;
      try {
        generationAttempts++;
        logger.info({ topic, model: env.CEREBRAS_MODEL, missing }, "Trying Cerebras fallback");
        const questions = await this.generateWithProvider(
          this.cerebrasConfig(),
          topic,
          difficulty,
          missing,
          onQuestion
        );
        allEmitted = [...allEmitted, ...questions];
        currentModel = allEmitted.length > questions.length
          ? `${currentModel} + cerebras/${env.CEREBRAS_MODEL}`
          : `cerebras/${env.CEREBRAS_MODEL}`;
        currentProvider = allEmitted.length > questions.length ? "mixed" : "cerebras";
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn({ err: lastError, topic }, "Cerebras fallback failed");
      }
    }

    // ── Step 3: OpenRouter fallback model ─────────────────────────────────
    if (env.OPENROUTER_API_KEY && env.OPENROUTER_MODEL_FALLBACK && allEmitted.length < count) {
      const missing = count - allEmitted.length;
      try {
        generationAttempts++;
        logger.info({ topic, model: env.OPENROUTER_MODEL_FALLBACK, missing }, "Trying OpenRouter fallback model");
        const questions = await this.generateWithProvider(
          this.openRouterConfig(env.OPENROUTER_MODEL_FALLBACK),
          topic,
          difficulty,
          missing,
          onQuestion
        );
        allEmitted = [...allEmitted, ...questions];
        currentModel = `${currentModel} + ${env.OPENROUTER_MODEL_FALLBACK}`;
        currentProvider = "mixed";
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn({ err: lastError, topic }, "OpenRouter fallback model failed");
      }
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
      provider: currentProvider,
      latencyMs: 0,
      firstQuestionLatencyMs: 0,
      fromCache: false,
      generationAttempts
    };
  }

  // ── Provider configs ──────────────────────────────────────────────────────

  private openRouterConfig(model: string): ProviderConfig {
    return {
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.OPENROUTER_SITE_URL,
        "X-Title": env.OPENROUTER_SITE_NAME
      },
      model,
      providerName: "openrouter"
    };
  }

  private cerebrasConfig(): ProviderConfig {
    return {
      url: "https://api.cerebras.ai/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${env.CEREBRAS_API_KEY}`,
        "Content-Type": "application/json"
      },
      model: env.CEREBRAS_MODEL,
      providerName: "cerebras"
    };
  }

  // ── Core streaming + parsing (shared across providers) ───────────────────

  private async generateWithProvider(
    config: ProviderConfig,
    topic: string,
    difficulty: Difficulty,
    count: number,
    onQuestion: (question: LlmQuestion) => Promise<void>
  ): Promise<LlmQuestion[]> {
    const prompt = this.buildQualityPrompt(topic, difficulty, count);

    const body = {
      model: config.model,
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
      temperature: 0.4,
      stream: true,
      max_tokens: Math.min(count * 380, 4096)
    };

    const startTime = Date.now();
    let firstQuestionLatencyMs: number | undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, LlmService.llmTimeoutMs);

    let response: Response;
    try {
      response = await fetch(config.url, {
        method: "POST",
        headers: config.headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${config.providerName} error (${response.status}): ${errorText || response.statusText}`);
    }

    if (!response.body) {
      throw new Error(`${config.providerName} response stream is empty`);
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
        logger.info(
          { provider: config.providerName, firstQuestionLatencyMs },
          "First question received"
        );
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

        let parsedChunk: LlmChunk;
        try {
          parsedChunk = JSON.parse(dataPayload) as LlmChunk;
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

  // ── Prompts ───────────────────────────────────────────────────────────────

  private buildSystemPrompt(): string {
    return `Eres un experto en crear preguntas de opción múltiple de alta calidad para quizzes educativos en español.

Genera preguntas que:
1. Sean precisas, claras y evalúen conocimiento real
2. Tengan distractores plausibles dentro del mismo dominio temático
3. La explicación sea específica: por qué la correcta es correcta Y por qué cada distractor es incorrecto
4. Usen lenguaje natural, no frases plantilla

IMPORTANTE: La respuesta correcta debe VARIAR entre A, B, C y D. No siempre pongas A.

Ejemplos de preguntas BUENAS (nota las diferentes letras correctas):

{"questionText":"¿Cuál es la capital de Francia?","options":{"A":"París","B":"Londres","C":"Berlín","D":"Madrid"},"correctOption":"A","explanation":"París es la capital de Francia desde el siglo X. Londres es capital del Reino Unido, Berlín de Alemania y Madrid de España.","subtopic":"geografía europea"}

{"questionText":"¿Qué lenguaje creó Guido van Rossum?","options":{"A":"Ruby","B":"Java","C":"Python","D":"Perl"},"correctOption":"C","explanation":"Python fue creado por Guido van Rossum en 1991. Ruby lo creó Matsumoto, Java fue desarrollado por Sun Microsystems y Perl por Larry Wall.","subtopic":"historia de lenguajes"}

{"questionText":"¿Cuál planeta del sistema solar tiene más lunas?","options":{"A":"Marte","B":"Saturno","C":"Júpiter","D":"Urano"},"correctOption":"B","explanation":"Saturno tiene más de 140 lunas confirmadas, superando a Júpiter. Marte solo tiene 2 lunas y Urano tiene 27.","subtopic":"astronomía"}

Ejemplo de pregunta MALA (NO GENERES ESTO):
{"questionText":"concepto 1","options":{"A":"una explicación concisa del concepto","B":"una descripción parcial","C":"afirmación no relacionada","D":"confusión común"},"correctOption":"A","explanation":"La opción A es correcta porque sí.","subtopic":"general"}

REGLAS CRÍTICAS:
- NUNCA uses patrones como "concepto N", "opción A/B/C/D", "afirmación resume mejor"
- La explicación DEBE mencionar la letra correcta tal como quedará en el JSON (ej: si correctOption es "C", la explicación dice "C es correcta porque...")
- Toda la salida debe ser en español
- Formato: NDJSON (un objeto JSON válido por línea, SIN markdown, SIN texto adicional)`;
  }

  private buildQualityPrompt(topic: string, difficulty: Difficulty, count: number): string {
    const difficultyText: Record<Difficulty, string> = {
      EASY: "básico — conceptos fundamentales, definiciones, datos concretos",
      MEDIUM: "intermedio — aplicación de conceptos, relaciones entre ideas",
      HARD: "avanzado — análisis crítico, resolución de problemas complejos"
    };

    // Suggest varied correct options to counteract model bias
    const optionHints = ["B", "D", "A", "C", "B", "D", "C", "A", "D", "B", "C", "A", "D", "C", "B"];
    const hints = optionHints.slice(0, count).join(", ");

    return `Genera exactamente ${count} preguntas de opción múltiple sobre "${topic}".

DIFICULTAD: ${difficultyText[difficulty]}

REGLAS OBLIGATORIAS:
1. Cada pregunta debe evaluar un aspecto CONCRETO y ESPECÍFICO del tema "${topic}"
2. Los distractores deben ser plausibles — respuestas que alguien con conocimiento parcial elegiría
3. La explicación debe ser detallada: explica por qué la correcta es correcta Y por qué cada distractor es incorrecto
4. NO uses frases plantilla como "concepto 1", "afirmación resume mejor", etc.
5. NO repitas el texto "${topic}" en todas las opciones
6. El subtopic debe ser un aspecto específico del tema, no "general"
7. DISTRIBUYE la respuesta correcta: usa letras variadas. Sugerencia para esta tanda: ${hints}
8. La explicación DEBE referenciar la letra correcta (ej: "La opción C es correcta porque...")

FORMATO: NDJSON — un objeto JSON válido por línea, sin markdown, sin arrays, sin comentarios.

Ejemplo de formato exacto:
{"questionText":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correctOption":"B","explanation":"La opción B es correcta porque... La A es incorrecta porque... La C es incorrecta porque...","subtopic":"..."}`;
  }

  // ── Cache helpers ─────────────────────────────────────────────────────────

  private buildCacheKey(topic: string, difficulty: Difficulty, count: number): string {
    const normalizedTopic = topic.trim().toLowerCase().replace(/\s+/g, " ");
    return `${normalizedTopic}::${difficulty}::${count}::es-v3-quality`;
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

  // ── Question parsing & validation ─────────────────────────────────────────

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

  // ── Shuffle + explanation rewrite ─────────────────────────────────────────

  private randomizeQuestionOptions(question: LlmQuestion): LlmQuestion {
    const optionSlots = ["A", "B", "C", "D"] as const;

    // Build a shuffled mapping: shuffled[newIndex].key = originalKey
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

    // Map: original key → new key
    const oldToNew: Record<string, string> = {};
    for (let i = 0; i < optionSlots.length; i++) {
      oldToNew[shuffled[i].key] = optionSlots[i];
    }

    const remappedIndex = shuffled.findIndex((entry) => entry.key === question.correctOption);
    const remappedCorrectOption = remappedIndex >= 0 ? optionSlots[remappedIndex] : question.correctOption;

    // Rewrite letter references in the explanation to match the new layout.
    // Use placeholder tokens to avoid chained replacement (e.g. A→C then C→D).
    let updatedExplanation = question.explanation;
    const needsRewrite = Object.entries(oldToNew).some(([oldKey, newKey]) => oldKey !== newKey);

    if (needsRewrite) {
      // Phase 1: replace "opción X" / "la X" / "respuesta X" patterns with __SLOT_X__ tokens
      for (const oldKey of optionSlots) {
        const newKey = oldToNew[oldKey];
        if (oldKey === newKey) continue;
        updatedExplanation = updatedExplanation.replace(
          new RegExp(`\\b(opci[oó]n|respuesta|alternativa|la|el)\\s+${oldKey}\\b`, "gi"),
          `$1 __SLOT_${newKey}__`
        );
      }
      // Phase 2: resolve tokens to actual keys
      for (const slot of optionSlots) {
        updatedExplanation = updatedExplanation.replaceAll(`__SLOT_${slot}__`, slot);
      }
    }

    return {
      ...question,
      options: remappedOptions,
      correctOption: remappedCorrectOption,
      explanation: updatedExplanation
    };
  }

  // ── Quality filters ───────────────────────────────────────────────────────

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
    // Valid correctOption
    if (!["A", "B", "C", "D"].includes(question.correctOption)) {
      return false;
    }

    // The correct answer text must exist and be non-trivial
    const correctText = question.options[question.correctOption as keyof typeof question.options];
    if (!correctText || correctText.trim().length < 3) {
      return false;
    }

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
      "the", "which", "what", "is", "are", "and", "or", "with",
      "about", "correct", "incorrect", "because", "best", "option",
      "question", "statement", "true", "false", "answer"
    ]);

    const spanishMarkers = new Set([
      "el", "la", "los", "las", "que", "cual", "es", "son", "y", "o",
      "con", "sobre", "correcta", "incorrecta", "porque", "mejor",
      "opcion", "pregunta", "afirmacion", "verdadero", "falso", "respuesta"
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

  // ── Local fallback ────────────────────────────────────────────────────────

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
