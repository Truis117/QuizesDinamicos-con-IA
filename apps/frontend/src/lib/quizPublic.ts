import { API_URL } from "./apiClient";

export type PublicQuestion = {
  id: string;
  orderIndex: number;
  questionText: string;
  options: {
    A: string;
    B: string;
    C: string;
    D: string;
  };
  difficultyAssigned: "EASY" | "MEDIUM" | "HARD";
};

export type PublicSessionPayload = {
  id: string;
  topic: string;
  currentDifficulty: "EASY" | "MEDIUM" | "HARD";
  createdAt: string;
  rounds: Array<{
    id: string;
    roundIndex: number;
    requestedCount: number;
    generatedCount: number;
    status: string;
    questions: PublicQuestion[];
  }>;
};

export async function fetchPublicSession(sessionId: string): Promise<PublicSessionPayload> {
  const response = await fetch(`${API_URL}/public/sessions/${sessionId}`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "No se pudo cargar el quiz publico");
  }
  return response.json();
}
