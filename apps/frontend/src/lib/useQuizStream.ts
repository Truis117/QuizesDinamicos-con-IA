import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "./apiClient";
import { SseEvent } from "@quiz/contracts";

type StreamQuestion = Extract<SseEvent, { event: "question" }>["payload"];
type StreamDifficulty = Extract<SseEvent, { event: "quiz_started" }>["payload"]["difficulty"];
type StreamStatus = "IDLE" | "CONNECTING" | "STREAMING" | "DONE" | "ERROR";

export function useQuizStream(sessionId: string | null) {
  const [questions, setQuestions] = useState<StreamQuestion[]>([]);
  const [status, setStatus] = useState<StreamStatus>("IDLE");
  const [error, setError] = useState<string | null>(null);
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [roundDifficulty, setRoundDifficulty] = useState<StreamDifficulty | null>(null);
  const [recommendedDifficulty, setRecommendedDifficulty] = useState<StreamDifficulty | null>(null);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [streamNonce, setStreamNonce] = useState(0);
  const streamHadErrorRef = useRef(false);

  const restart = useCallback(() => {
    setStreamNonce((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    setStatus("CONNECTING");
    setError(null);
    setQuestions([]);
    setTargetCount(null);
    setTopic(null);
    setRoundDifficulty(null);
    setRecommendedDifficulty(null);
    streamHadErrorRef.current = false;

    // We can't easily pass headers like Authorization to native EventSource.
    // For P0, we could use standard fetch and parse chunks, or just rely on a token in query param.
    // Let's implement a simple fetch-based line parser to support auth header.

    const abortController = new AbortController();

    async function connect() {
      try {
        const res = await api.fetch(`/sessions/${sessionId}/stream`, {
          signal: abortController.signal,
        });

        if (!res.body) throw new Error("No response body");
        
        setStatus("STREAMING");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const chunk of lines) {
            if (!chunk.trim()) continue;
            
            // Parse SSE chunk
            const dataLine = chunk.split("\n").find(l => l.startsWith("data: "));
            if (dataLine) {
              try {
                const data = JSON.parse(dataLine.replace("data: ", ""));
                handleEvent(data as SseEvent);
              } catch (e) {
                console.error("Failed to parse event", e);
              }
            }
          }
        }
        
        if (!streamHadErrorRef.current) {
          setStatus("DONE");
        }
      } catch (err: any) {
        if (err.name === "AbortError") return;
        streamHadErrorRef.current = true;
        setError(err.message);
        setStatus("ERROR");
      }
    }

    connect();

    return () => {
      abortController.abort();
    };
  }, [sessionId, streamNonce]);

  function handleEvent(event: SseEvent) {
    if (event.event === "quiz_started") {
      setTargetCount(event.payload.questionCount);
      setTopic(event.payload.topic);
      setRoundDifficulty(event.payload.difficulty);
      setCurrentStreak(event.payload.currentStreak);
    } else if (event.event === "question") {
      setQuestions(prev => {
        // Dedup by orderIndex
        if (prev.some(q => q.orderIndex === event.payload.orderIndex)) return prev;
        return [...prev, event.payload].sort((a, b) => a.orderIndex - b.orderIndex);
      });
    } else if (event.event === "error") {
      streamHadErrorRef.current = true;
      setError(event.payload.message);
      setStatus("ERROR");
    } else if (event.event === "round_done" && !streamHadErrorRef.current) {
      setRecommendedDifficulty(event.payload.recommendedDifficulty);
      setStatus("DONE");
    }
  }

  return {
    questions,
    status,
    error,
    targetCount,
    topic,
    roundDifficulty,
    recommendedDifficulty,
    currentStreak,
    restart
  };
}
