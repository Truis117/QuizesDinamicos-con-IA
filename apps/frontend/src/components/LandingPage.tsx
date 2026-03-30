import React from "react";
import { useSeo } from "../lib/seo";

const quickTopics = [
  "Historia de Roma",
  "React Hooks",
  "Biologia celular",
  "Algebra lineal",
  "Marketing digital",
  "Ciberseguridad"
];

export function LandingPage({ onGetStarted }: { onGetStarted: () => void }) {
  useSeo({
    title: "QuizDinamico AI | Cuestionarios con IA",
    description:
      "Genera quizzes al instante, aprende con dificultad adaptativa y refuerza conceptos con explicaciones en tiempo real.",
    path: "/",
    robots: "index,follow"
  });

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center py-10">
      <div className="rounded-3xl border border-white/10 bg-[var(--color-surface-glass)] p-6 shadow-2xl backdrop-blur-xl md:p-10">
        <p className="mb-4 inline-flex rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold tracking-[0.08em] text-accent-light uppercase">
          Aprendizaje adaptativo con IA
        </p>

        <h1 className="mb-4 text-4xl leading-tight font-heading font-bold text-white md:text-6xl md:leading-[1.05]">
          Domina cualquier tema con quizzes dinamicos
        </h1>

        <p className="max-w-2xl text-base text-white/75 md:text-lg">
          Genera cuestionarios al instante, recibe explicaciones claras y mejora con
          dificultad que se adapta a tu rendimiento.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quickTopics.map((topic) => (
            <div
              key={topic}
              className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/80"
            >
              {topic}
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            onClick={onGetStarted}
            className="inline-flex items-center justify-center rounded-2xl bg-accent px-6 py-4 text-base font-semibold text-white shadow-[0_0_24px_rgba(94,106,210,0.45)] transition-transform duration-150 hover:scale-[0.98] hover:bg-accent/90 active:scale-95"
          >
            Empieza gratis
          </button>
          <p className="text-sm text-white/60">Sin tarjeta de credito. Registro en segundos.</p>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-lg font-heading font-semibold text-white">Streaming en vivo</h2>
          <p className="mt-2 text-sm text-white/65">
            Las preguntas llegan en tiempo real para mantener el ritmo de estudio.
          </p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-lg font-heading font-semibold text-white">Dificultad adaptativa</h2>
          <p className="mt-2 text-sm text-white/65">
            El sistema ajusta el nivel segun tus respuestas para un progreso continuo.
          </p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-lg font-heading font-semibold text-white">Feedback util</h2>
          <p className="mt-2 text-sm text-white/65">
            Cada intento incluye explicacion para reforzar conceptos al momento.
          </p>
        </article>
      </div>
    </section>
  );
}
