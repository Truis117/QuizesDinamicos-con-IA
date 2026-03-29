import { z } from "zod";

export const DifficultySchema = z.enum(["EASY", "MEDIUM", "HARD"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const SessionStatusSchema = z.enum([
  "CREATED",
  "GENERATING",
  "IN_PROGRESS",
  "PAUSED",
  "COMPLETED",
  "FAILED"
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const RoundStatusSchema = z.enum([
  "CREATED",
  "GENERATING",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED"
]);
export type RoundStatus = z.infer<typeof RoundStatusSchema>;

export const OptionKeySchema = z.enum(["A", "B", "C", "D"]);
export type OptionKey = z.infer<typeof OptionKeySchema>;

export const QuestionOptionsSchema = z.object({
  A: z.string().min(1),
  B: z.string().min(1),
  C: z.string().min(1),
  D: z.string().min(1)
});
export type QuestionOptions = z.infer<typeof QuestionOptionsSchema>;

export const RegisterBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});
export type RegisterBody = z.infer<typeof RegisterBodySchema>;

export const LoginBodySchema = RegisterBodySchema;
export type LoginBody = z.infer<typeof LoginBodySchema>;

export const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1)
});
export type RefreshBody = z.infer<typeof RefreshBodySchema>;

export const CreateSessionBodySchema = z.object({
  topic: z.string().min(2).max(180),
  sourceMaterial: z.string().min(20).max(12000).optional(),
  sourceUrl: z.string().url().optional()
});
export type CreateSessionBody = z.infer<typeof CreateSessionBodySchema>;

export const CreateRoundBodySchema = z.object({
  count: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  difficulty: DifficultySchema.optional(),
  sourceMaterial: z.string().min(20).max(12000).optional(),
  sourceUrl: z.string().url().optional()
});
export type CreateRoundBody = z.infer<typeof CreateRoundBodySchema>;

export const AttemptBodySchema = z.object({
  attemptId: z.string().min(8).max(128),
  selectedOption: OptionKeySchema,
  responseTimeSec: z.number().min(0).max(3600).optional()
});
export type AttemptBody = z.infer<typeof AttemptBodySchema>;

export const SessionSummarySubtopicSchema = z.object({
  subtopic: z.string(),
  attempts: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  wrong: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  masteryScore: z.number().min(0).max(1)
});
export type SessionSummarySubtopic = z.infer<typeof SessionSummarySubtopicSchema>;

export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  topic: z.string(),
  totals: z.object({
    answered: z.number().int().nonnegative(),
    correct: z.number().int().nonnegative(),
    wrong: z.number().int().nonnegative(),
    accuracy: z.number().min(0).max(1),
    avgResponseTimeSec: z.number().min(0)
  }),
  subtopics: z.array(SessionSummarySubtopicSchema),
  recommendations: z.array(z.string())
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const UserPublicSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  globalScore: z.number().int()
});
export type UserPublic = z.infer<typeof UserPublicSchema>;

export const QuizStartedEventSchema = z.object({
  event: z.literal("quiz_started"),
  eventId: z.number().int().nonnegative(),
  sessionId: z.string(),
  roundId: z.string(),
  payload: z.object({
    topic: z.string(),
    difficulty: DifficultySchema,
    questionCount: z.number().int().positive()
  })
});

export const QuestionEventSchema = z.object({
  event: z.literal("question"),
  eventId: z.number().int().nonnegative(),
  sessionId: z.string(),
  roundId: z.string(),
  payload: z.object({
    id: z.string(),
    orderIndex: z.number().int().nonnegative(),
    questionText: z.string(),
    options: QuestionOptionsSchema,
    difficulty: DifficultySchema
  })
});

export const AnswerFeedbackEventSchema = z.object({
  event: z.literal("answer_feedback"),
  eventId: z.number().int().nonnegative(),
  sessionId: z.string(),
  roundId: z.string(),
  payload: z.object({
    questionId: z.string(),
    isCorrect: z.boolean(),
    correctOption: OptionKeySchema,
    explanation: z.string(),
    scoreDelta: z.number().int()
  })
});

export const RoundDoneEventSchema = z.object({
  event: z.literal("round_done"),
  eventId: z.number().int().nonnegative(),
  sessionId: z.string(),
  roundId: z.string(),
  payload: z.object({
    generatedCount: z.number().int().nonnegative(),
    requestedCount: z.number().int().positive(),
    recommendedDifficulty: DifficultySchema
  })
});

export const ErrorEventSchema = z.object({
  event: z.literal("error"),
  eventId: z.number().int().nonnegative(),
  sessionId: z.string(),
  roundId: z.string().optional(),
  payload: z.object({
    code: z.string(),
    message: z.string()
  })
});

export const SseEventSchema = z.discriminatedUnion("event", [
  QuizStartedEventSchema,
  QuestionEventSchema,
  AnswerFeedbackEventSchema,
  RoundDoneEventSchema,
  ErrorEventSchema
]);
export type SseEvent = z.infer<typeof SseEventSchema>;

export const LlmQuestionSchema = z.object({
  questionText: z.string().min(10),
  options: QuestionOptionsSchema,
  correctOption: OptionKeySchema,
  explanation: z.string().min(8),
  subtopic: z.string().min(2).max(120).default("general")
});
export type LlmQuestion = z.infer<typeof LlmQuestionSchema>;

export const LlmOutputSchema = z.object({
  questions: z.array(LlmQuestionSchema).min(1)
});
export type LlmOutput = z.infer<typeof LlmOutputSchema>;

export function serializeSseEvent(event: SseEvent): string {
  return `id: ${event.eventId}\nevent: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`;
}
