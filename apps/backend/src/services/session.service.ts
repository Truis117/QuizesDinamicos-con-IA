import { Request, Response } from "express";
import {
  AttemptBody,
  CreateRoundBody,
  Difficulty,
  SessionSummary,
  SessionSummarySchema,
  SseEvent,
  serializeSseEvent
} from "@quiz/contracts";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";
import { LlmService } from "./llm.service.js";

type RoundStreamState = {
  sessionId: string;
  roundId: string;
  nextEventId: number;
  events: SseEvent[];
  clients: Set<Response>;
  generationStarted: boolean;
  finished: boolean;
  expiresAt: number;
};

export class SessionService {
  private static streamStates = new Map<string, RoundStreamState>();
  private llmService = new LlmService();

  async createSession(userId: string, topic: string) {
    return prisma.quizSession.create({
      data: {
        userId,
        topic,
        status: "CREATED",
        currentDifficulty: "MEDIUM"
      }
    });
  }

  async listSessions(userId: string) {
    return prisma.quizSession.findMany({
      where: { userId },
      include: {
        rounds: {
          orderBy: { roundIndex: "desc" },
          take: 1,
          select: {
            id: true,
            roundIndex: true,
            status: true,
            requestedCount: true,
            generatedCount: true,
            requestedDifficulty: true,
            createdAt: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  }

  async getSession(userId: string, sessionId: string) {
    return prisma.quizSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        rounds: {
          orderBy: { roundIndex: "desc" },
          include: {
            questions: {
              orderBy: { orderIndex: "asc" },
              select: {
                id: true,
                orderIndex: true,
                questionText: true,
                options: true,
                difficultyAssigned: true,
                subtopic: true,
                createdAt: true
              }
            }
          }
        }
      }
    });
  }

  async createRound(userId: string, sessionId: string, data: CreateRoundBody) {
    const session = await prisma.quizSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        rounds: {
          orderBy: { roundIndex: "desc" },
          take: 1
        }
      }
    });

    if (!session) {
      throw new Error("Session not found");
    }

    const latestRound = session.rounds[0];
    if (latestRound?.status === "GENERATING") {
      throw new Error("A round is already generating");
    }

    const difficulty = data.difficulty ?? session.currentDifficulty;
    const roundIndex = (latestRound?.roundIndex ?? 0) + 1;

    const round = await prisma.quizRound.create({
      data: {
        sessionId,
        roundIndex,
        requestedCount: data.count,
        requestedDifficulty: difficulty,
        status: "GENERATING"
      }
    });

    await prisma.quizSession.update({
      where: { id: session.id },
      data: {
        status: "GENERATING"
      }
    });

    return round;
  }

  async streamRound(userId: string, sessionId: string, _req: Request, res: Response) {
    this.cleanupExpiredStates();

    const session = await prisma.quizSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        rounds: {
          orderBy: { roundIndex: "desc" },
          take: 1
        }
      }
    });

    if (!session || session.rounds.length === 0) {
      res.status(404).json({ error: "Session or round not found" });
      return;
    }

    const round = session.rounds[0];
    if (!round) {
      res.status(404).json({ error: "Round not found" });
      return;
    }

    this.prepareSseResponse(res);

    const state = await this.getOrCreateStreamState(session.id, round.id);
    const lastEventId = this.parseLastEventId(_req);
    this.sendBufferedEvents(res, state, lastEventId);

    if (state.finished) {
      res.end();
      return;
    }

    state.clients.add(res);
    state.expiresAt = Date.now() + env.SSE_STATE_TTL_SEC * 1000;

    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`: ping ${Date.now()}\n\n`);
      }
    }, 15000);

    _req.on("close", () => {
      clearInterval(keepAlive);
      state.clients.delete(res);
      state.expiresAt = Date.now() + env.SSE_STATE_TTL_SEC * 1000;
    });

    if (!state.generationStarted && round.status === "GENERATING") {
      state.generationStarted = true;
      void this.generateRound(session.id, round.id).catch((err) => {
        logger.error({ err, sessionId, roundId: round.id }, "Round generation task failed");
      });
    }
  }

  async attemptQuestion(
    userId: string,
    sessionId: string,
    questionId: string,
    data: AttemptBody
  ) {
    const question = await prisma.question.findFirst({
      where: {
        id: questionId,
        round: {
          sessionId,
          session: {
            userId
          }
        }
      },
      include: {
        round: {
          include: {
            session: {
              select: {
                topic: true
              }
            }
          }
        }
      }
    });

    if (!question) {
      throw new Error("Question not found");
    }

    const byAttemptId = await prisma.questionAttempt.findUnique({
      where: { attemptId: data.attemptId }
    });

    if (byAttemptId) {
      return {
        attempt: byAttemptId,
        feedback: {
          isCorrect: byAttemptId.isCorrect,
          correctOption: question.correctOption,
          explanation: question.explanation,
          scoreDelta: byAttemptId.scoreDelta
        }
      };
    }

    const existingForQuestion = await prisma.questionAttempt.findUnique({
      where: {
        questionId_userId: {
          questionId,
          userId
        }
      }
    });

    if (existingForQuestion) {
      return {
        attempt: existingForQuestion,
        feedback: {
          isCorrect: existingForQuestion.isCorrect,
          correctOption: question.correctOption,
          explanation: question.explanation,
          scoreDelta: existingForQuestion.scoreDelta
        }
      };
    }

    const isCorrect = question.correctOption === data.selectedOption;
    const scoreDelta = isCorrect ? 1 : -1;
    const topic = question.round.session.topic;
    const subtopic = question.subtopic;

    const result = await prisma.$transaction(async (tx) => {
      const attempt = await tx.questionAttempt.create({
        data: {
          userId,
          questionId,
          attemptId: data.attemptId,
          selectedOption: data.selectedOption,
          isCorrect,
          responseTimeSec: data.responseTimeSec,
          scoreDelta
        }
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          globalScore: {
            increment: scoreDelta
          }
        }
      });

      const mastery = await tx.subtopicMastery.findUnique({
        where: {
          userId_topic_subtopic: {
            userId,
            topic,
            subtopic
          }
        }
      });

      const nextCorrect = (mastery?.correctCount ?? 0) + (isCorrect ? 1 : 0);
      const nextWrong = (mastery?.wrongCount ?? 0) + (isCorrect ? 0 : 1);
      const nextTotal = nextCorrect + nextWrong;
      const masteryScore = nextTotal === 0 ? 0 : nextCorrect / nextTotal;

      if (mastery) {
        await tx.subtopicMastery.update({
          where: {
            userId_topic_subtopic: {
              userId,
              topic,
              subtopic
            }
          },
          data: {
            correctCount: nextCorrect,
            wrongCount: nextWrong,
            masteryScore
          }
        });
      } else {
        await tx.subtopicMastery.create({
          data: {
            userId,
            topic,
            subtopic,
            correctCount: nextCorrect,
            wrongCount: nextWrong,
            masteryScore
          }
        });
      }

      return attempt;
    });

    return {
      attempt: result,
      feedback: {
        isCorrect,
        correctOption: question.correctOption,
        explanation: question.explanation,
        scoreDelta
      }
    };
  }

  async getSessionSummary(userId: string, sessionId: string): Promise<SessionSummary> {
    const session = await prisma.quizSession.findFirst({
      where: { id: sessionId, userId },
      select: {
        id: true,
        topic: true
      }
    });

    if (!session) {
      throw new Error("Session not found");
    }

    const attempts = await prisma.questionAttempt.findMany({
      where: {
        userId,
        question: {
          round: {
            sessionId
          }
        }
      },
      include: {
        question: {
          select: {
            subtopic: true
          }
        }
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    const answered = attempts.length;
    const correct = attempts.filter((item) => item.isCorrect).length;
    const wrong = answered - correct;

    const responseTimes = attempts
      .map((item) => item.responseTimeSec)
      .filter((value): value is number => typeof value === "number");

    const avgResponseTimeSec =
      responseTimes.length === 0
        ? 0
        : responseTimes.reduce((acc, value) => acc + value, 0) / responseTimes.length;

    const bySubtopic = new Map<
      string,
      {
        attempts: number;
        correct: number;
        wrong: number;
      }
    >();

    for (const attempt of attempts) {
      const key = attempt.question.subtopic || "general";
      const current = bySubtopic.get(key) ?? {
        attempts: 0,
        correct: 0,
        wrong: 0
      };

      current.attempts += 1;
      if (attempt.isCorrect) {
        current.correct += 1;
      } else {
        current.wrong += 1;
      }

      bySubtopic.set(key, current);
    }

    const masteryRows = await prisma.subtopicMastery.findMany({
      where: {
        userId,
        topic: session.topic,
        subtopic: {
          in: Array.from(bySubtopic.keys())
        }
      }
    });

    const masteryMap = new Map(masteryRows.map((row) => [row.subtopic, row.masteryScore]));

    const subtopics = Array.from(bySubtopic.entries())
      .map(([subtopic, stats]) => {
        const accuracy = stats.attempts === 0 ? 0 : stats.correct / stats.attempts;
        const masteryScore = masteryMap.get(subtopic) ?? accuracy;

        return {
          subtopic,
          attempts: stats.attempts,
          correct: stats.correct,
          wrong: stats.wrong,
          accuracy,
          masteryScore
        };
      })
      .sort((a, b) => a.masteryScore - b.masteryScore);

    const weakAreas = subtopics.filter((item) => item.masteryScore < 0.65).slice(0, 3);
    const recommendations =
      weakAreas.length > 0
        ? weakAreas.map(
            (item) =>
              `Repasa "${item.subtopic}" con ejemplos guiados antes de subir dificultad.`
          )
        : ["Buen trabajo. Mantén la racha o prueba una dificultad mayor."];

    const summary: SessionSummary = {
      sessionId: session.id,
      topic: session.topic,
      totals: {
        answered,
        correct,
        wrong,
        accuracy: answered === 0 ? 0 : correct / answered,
        avgResponseTimeSec
      },
      subtopics,
      recommendations
    };

    return SessionSummarySchema.parse(summary);
  }

  private async generateRound(sessionId: string, roundId: string) {
    const state = SessionService.streamStates.get(roundId);
    if (!state || state.finished) {
      return;
    }

    const session = await prisma.quizSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        topic: true,
        currentDifficulty: true
      }
    });

    const round = await prisma.quizRound.findUnique({
      where: { id: roundId },
      select: {
        id: true,
        requestedCount: true,
        requestedDifficulty: true,
        status: true,
        generatedCount: true
      }
    });

    if (!session || !round) {
      return;
    }

    if (round.status !== "GENERATING") {
      return;
    }

    try {
      const existingQuestions = await prisma.question.findMany({
        where: { roundId: round.id },
        orderBy: { orderIndex: "asc" }
      });

      let orderIndex = existingQuestions.length;
      const remainingCount = Math.max(round.requestedCount - existingQuestions.length, 0);

      let generationResult:
        | Awaited<ReturnType<LlmService["generateQuestionsStream"]>>
        | undefined;

      if (remainingCount > 0) {
        generationResult = await this.llmService.generateQuestionsStream(
          session.topic,
          round.requestedDifficulty,
          remainingCount,
          async (qData) => {
            const savedQuestion = await prisma.question.create({
              data: {
                roundId: round.id,
                orderIndex,
                questionText: qData.questionText,
                options: qData.options,
                correctOption: qData.correctOption,
                explanation: qData.explanation,
                subtopic: qData.subtopic,
                difficultyAssigned: round.requestedDifficulty,
                generationModel: generationResult?.model ?? env.OPENROUTER_MODEL_PRIMARY,
                promptVersion: "v2.ndjson"
              }
            });

            this.pushEvent(state, {
              event: "question",
              eventId: state.nextEventId++,
              sessionId: session.id,
              roundId: round.id,
              payload: {
                id: savedQuestion.id,
                orderIndex: savedQuestion.orderIndex,
                questionText: savedQuestion.questionText,
                options: savedQuestion.options as {
                  A: string;
                  B: string;
                  C: string;
                  D: string;
                },
                difficulty: savedQuestion.difficultyAssigned
              }
            });

            orderIndex += 1;
          }
        );
      }

      const generatedCount = orderIndex;
      const recommendedDifficulty = await this.calculateRecommendedDifficulty(
        session.userId,
        session.id,
        session.currentDifficulty
      );

      await prisma.$transaction(async (tx) => {
        await tx.quizRound.update({
          where: { id: round.id },
          data: {
            status: "IN_PROGRESS",
            generatedCount
          }
        });

        await tx.quizSession.update({
          where: { id: session.id },
          data: {
            status: "IN_PROGRESS",
            currentDifficulty: recommendedDifficulty
          }
        });

        if (generationResult) {
          const estimatedCostUsd = this.estimateCostUsd(
            generationResult.promptTokens,
            generationResult.completionTokens
          );

          await tx.llmTrace.create({
            data: {
              sessionId: session.id,
              roundId: round.id,
              model: generationResult.model,
              provider: generationResult.provider,
              promptTokens: generationResult.promptTokens,
              completionTokens: generationResult.completionTokens,
              latencyMs: generationResult.latencyMs,
              estimatedCostUsd
            }
          });
        }
      });

      this.pushEvent(state, {
        event: "round_done",
        eventId: state.nextEventId++,
        sessionId: session.id,
        roundId: round.id,
        payload: {
          generatedCount,
          requestedCount: round.requestedCount,
          recommendedDifficulty
        }
      });

      state.finished = true;
      state.expiresAt = Date.now() + env.SSE_STATE_TTL_SEC * 1000;
      this.closeAllClients(state);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error generating questions";

      await prisma.quizRound.update({
        where: { id: round.id },
        data: {
          status: "FAILED"
        }
      });

      await prisma.quizSession.update({
        where: { id: session.id },
        data: {
          status: "FAILED"
        }
      });

      this.pushEvent(state, {
        event: "error",
        eventId: state.nextEventId++,
        sessionId: session.id,
        roundId: round.id,
        payload: {
          code: "LLM_ERROR",
          message
        }
      });

      state.finished = true;
      state.expiresAt = Date.now() + env.SSE_STATE_TTL_SEC * 1000;
      this.closeAllClients(state);
    }
  }

  private async getOrCreateStreamState(sessionId: string, roundId: string): Promise<RoundStreamState> {
    const existing = SessionService.streamStates.get(roundId);
    if (existing) {
      existing.expiresAt = Date.now() + env.SSE_STATE_TTL_SEC * 1000;
      return existing;
    }

    const [session, round, questions] = await Promise.all([
      prisma.quizSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          topic: true,
          userId: true,
          currentDifficulty: true
        }
      }),
      prisma.quizRound.findUnique({
        where: { id: roundId },
        select: {
          id: true,
          requestedCount: true,
          requestedDifficulty: true,
          status: true,
          generatedCount: true
        }
      }),
      prisma.question.findMany({
        where: { roundId },
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          orderIndex: true,
          questionText: true,
          options: true,
          difficultyAssigned: true
        }
      })
    ]);

    if (!session || !round) {
      throw new Error("Session or round not found");
    }

    const state: RoundStreamState = {
      sessionId,
      roundId,
      nextEventId: 1,
      events: [],
      clients: new Set(),
      generationStarted: false,
      finished: false,
      expiresAt: Date.now() + env.SSE_STATE_TTL_SEC * 1000
    };

    this.pushEvent(state, {
      event: "quiz_started",
      eventId: state.nextEventId++,
      sessionId,
      roundId,
      payload: {
        topic: session.topic,
        difficulty: round.requestedDifficulty,
        questionCount: round.requestedCount
      }
    });

    for (const question of questions) {
      this.pushEvent(state, {
        event: "question",
        eventId: state.nextEventId++,
        sessionId,
        roundId,
        payload: {
          id: question.id,
          orderIndex: question.orderIndex,
          questionText: question.questionText,
          options: question.options as {
            A: string;
            B: string;
            C: string;
            D: string;
          },
          difficulty: question.difficultyAssigned
        }
      });
    }

    const shouldBeFinished =
      round.status === "FAILED" ||
      round.status === "IN_PROGRESS" ||
      round.status === "COMPLETED" ||
      questions.length >= round.requestedCount;

    if (shouldBeFinished) {
      if (round.status === "FAILED") {
        this.pushEvent(state, {
          event: "error",
          eventId: state.nextEventId++,
          sessionId,
          roundId,
          payload: {
            code: "ROUND_FAILED",
            message: "Round generation failed"
          }
        });
      } else {
        const recommendedDifficulty = await this.calculateRecommendedDifficulty(
          session.userId,
          session.id,
          session.currentDifficulty
        );

        this.pushEvent(state, {
          event: "round_done",
          eventId: state.nextEventId++,
          sessionId,
          roundId,
          payload: {
            generatedCount: questions.length,
            requestedCount: round.requestedCount,
            recommendedDifficulty
          }
        });
      }

      state.finished = true;
    }

    SessionService.streamStates.set(roundId, state);
    return state;
  }

  private pushEvent(state: RoundStreamState, event: SseEvent) {
    state.events.push(event);

    if (state.events.length > 300) {
      state.events.splice(0, state.events.length - 300);
    }

    const payload = serializeSseEvent(event);
    for (const client of state.clients) {
      if (!client.writableEnded) {
        client.write(payload);
      }
    }
  }

  private sendBufferedEvents(res: Response, state: RoundStreamState, lastEventId: number) {
    for (const event of state.events) {
      if (event.eventId > lastEventId) {
        res.write(serializeSseEvent(event));
      }
    }
  }

  private prepareSseResponse(res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write("retry: 1500\n\n");
  }

  private parseLastEventId(req: Request): number {
    const headerValue = req.header("last-event-id") ?? req.query.lastEventId;
    if (typeof headerValue !== "string") return 0;

    const parsed = Number.parseInt(headerValue, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }

    return parsed;
  }

  private closeAllClients(state: RoundStreamState) {
    for (const client of state.clients) {
      if (!client.writableEnded) {
        client.end();
      }
    }
    state.clients.clear();
  }

  private cleanupExpiredStates() {
    const now = Date.now();
    for (const [roundId, state] of SessionService.streamStates.entries()) {
      if (state.clients.size > 0) continue;
      if (state.expiresAt > now) continue;
      SessionService.streamStates.delete(roundId);
    }
  }

  private estimateCostUsd(promptTokens?: number, completionTokens?: number): number | null {
    if (promptTokens === undefined && completionTokens === undefined) {
      return null;
    }

    const promptCost = (promptTokens ?? 0) * env.LLM_PROMPT_TOKEN_COST_USD;
    const completionCost = (completionTokens ?? 0) * env.LLM_COMPLETION_TOKEN_COST_USD;
    return promptCost + completionCost;
  }

  private async calculateRecommendedDifficulty(
    userId: string,
    sessionId: string,
    currentDifficulty: Difficulty
  ): Promise<Difficulty> {
    const recentAttempts = await prisma.questionAttempt.findMany({
      where: {
        userId,
        question: {
          round: {
            sessionId
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 10,
      select: {
        isCorrect: true,
        responseTimeSec: true
      }
    });

    if (recentAttempts.length === 0) {
      return currentDifficulty;
    }

    const accuracyRolling =
      recentAttempts.filter((attempt) => attempt.isCorrect).length / recentAttempts.length;

    const validResponseTimes = recentAttempts
      .map((attempt) => attempt.responseTimeSec)
      .filter((time): time is number => typeof time === "number");

    const avgResponseTimeSec =
      validResponseTimes.length === 0
        ? 999
        : validResponseTimes.reduce((acc, value) => acc + value, 0) / validResponseTimes.length;

    if (accuracyRolling >= 0.8 && avgResponseTimeSec <= 12) {
      return this.shiftDifficulty(currentDifficulty, +1);
    }

    if (accuracyRolling < 0.5) {
      return this.shiftDifficulty(currentDifficulty, -1);
    }

    return currentDifficulty;
  }

  private shiftDifficulty(current: Difficulty, delta: -1 | 1): Difficulty {
    const levels: Difficulty[] = ["EASY", "MEDIUM", "HARD"];
    const index = levels.indexOf(current);
    if (index === -1) return "MEDIUM";

    const nextIndex = Math.max(0, Math.min(levels.length - 1, index + delta));
    return levels[nextIndex] ?? current;
  }
}
