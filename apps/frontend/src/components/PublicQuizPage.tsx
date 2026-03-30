import React, { useEffect, useMemo, useState } from "react";
import { fetchPublicSession, PublicSessionPayload } from "../lib/quizPublic";
import { useSeo } from "../lib/seo";

function formatDate(dateIso: string) {
  const date = new Date(dateIso);
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

export function PublicQuizPage({ sessionId, onGoToApp }: { sessionId: string; onGoToApp: () => void }) {
  const [payload, setPayload] = useState<PublicSessionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    setError(null);

    fetchPublicSession(sessionId)
      .then((data) => {
        if (!mounted) return;
        setPayload(data);
      })
      .catch((err) => {
        if (!mounted) return;
        setPayload(null);
        setError(err instanceof Error ? err.message : "No se pudo cargar el quiz");
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [sessionId]);

  const questions = useMemo(() => {
    if (!payload) return [];
    return payload.rounds
      .flatMap((round) => round.questions.map((question) => ({ question, roundIndex: round.roundIndex })))
      .sort((a, b) => {
        if (a.roundIndex !== b.roundIndex) {
          return a.roundIndex - b.roundIndex;
        }
        return a.question.orderIndex - b.question.orderIndex;
      })
      .map(({ question }) => question);
  }, [payload]);

  const topic = payload?.topic ?? "Quiz publico";
  const quizSlug = payload?.topic
    ? payload.topic
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
    : null;
  const canonicalPath = quizSlug ? `/quiz/${sessionId}/${quizSlug}` : `/quiz/${sessionId}`;

  useSeo({
    title: `${topic} | Quiz publico - QuizDinamico AI`,
    description:
      payload
        ? `Practica ${payload.topic} con preguntas generadas por IA. Explora un quiz publico y sigue aprendiendo en QuizDinamico AI.`
        : "Explora cuestionarios publicos generados por IA en QuizDinamico AI.",
    path: canonicalPath,
    robots: error ? "noindex,follow" : "index,follow"
  });

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-4xl py-12">
        <div className="rounded-3xl border border-white/10 bg-[var(--color-surface-glass)] p-8 backdrop-blur-xl">
          <p className="text-white/70">Cargando quiz publico...</p>
        </div>
      </section>
    );
  }

  if (error || !payload) {
    return (
      <section className="mx-auto w-full max-w-4xl py-12">
        <div className="rounded-3xl border border-danger/30 bg-danger/10 p-8">
          <h1 className="text-2xl font-heading font-bold text-white">Quiz no disponible</h1>
          <p className="mt-3 text-white/75">{error ?? "No encontramos este quiz."}</p>
          <button
            onClick={onGoToApp}
            className="mt-6 rounded-xl bg-accent px-5 py-3 font-semibold text-white transition hover:bg-accent/90"
          >
            Ir a la aplicacion
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-4xl py-10">
      <header className="rounded-3xl border border-white/10 bg-[var(--color-surface-glass)] p-6 backdrop-blur-xl md:p-8">
        <p className="inline-flex rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-accent-light">
          Quiz publico
        </p>
        <h1 className="mt-4 text-3xl font-heading font-bold text-white md:text-5xl">{payload.topic}</h1>
        <p className="mt-3 text-sm text-white/70">
          {questions.length} preguntas • Dificultad actual: {payload.currentDifficulty} • Creado el {formatDate(payload.createdAt)}
        </p>
        <button
          onClick={onGoToApp}
          className="mt-6 rounded-xl bg-accent px-5 py-3 font-semibold text-white transition hover:bg-accent/90"
        >
          Practicar en la app
        </button>
      </header>

      <div className="mt-8 space-y-6">
        {questions.map((question, index) => (
          <article key={question.id} className="rounded-3xl border border-white/10 bg-[var(--color-bg-elevated)] p-6 shadow-xl">
            <h2 className="text-xl font-heading font-semibold text-white">
              {index + 1}. {question.questionText}
            </h2>
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {Object.entries(question.options).map(([label, value]) => (
                <li
                  key={label}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white/85"
                >
                  <span className="mr-2 font-mono text-accent-light">{label}.</span>
                  {value}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
