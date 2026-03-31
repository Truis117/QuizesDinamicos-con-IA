import React, { useEffect, useState } from "react";
import { useSeo } from "../lib/seo";

// ── Animated mock quiz card ──────────────────────────────────────────────────
const DEMO_QUESTION = "¿Qué estructura de Python almacena pares clave-valor?";
const DEMO_OPTIONS  = ["A. Lista", "B. Diccionario", "C. Tupla", "D. Set"];

function DemoCard() {
  const [chars, setChars]           = useState(0);
  const [optVisible, setOptVisible] = useState(false);
  const [chosen, setChosen]         = useState<number | null>(null);

  useEffect(() => {
    const startDelay = setTimeout(() => {
      let i = 0;
      const tick = setInterval(() => {
        i += 2;
        setChars(Math.min(i, DEMO_QUESTION.length));
        if (i >= DEMO_QUESTION.length) {
          clearInterval(tick);
          setTimeout(() => setOptVisible(true), 300);
        }
      }, 22);
      return () => clearInterval(tick);
    }, 600);
    return () => clearTimeout(startDelay);
  }, []);

  return (
    <div className="rounded-2xl border border-accent/25 bg-[var(--color-bg-elevated)] p-5 shadow-[0_0_40px_rgba(94,106,210,0.12)] select-none">
      {/* status bar */}
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
        <span className="text-xs text-accent-light font-mono">Generando con IA…</span>
      </div>

      {/* question */}
      <p className="text-white font-medium text-sm mb-4 min-h-[2.5rem]">
        {DEMO_QUESTION.slice(0, chars)}
        {chars < DEMO_QUESTION.length && (
          <span className="inline-block w-0.5 h-4 bg-accent-light animate-pulse align-middle ml-px" />
        )}
      </p>

      {/* options */}
      <div className="grid grid-cols-2 gap-2">
        {DEMO_OPTIONS.map((opt, i) => (
          <button
            key={opt}
            onClick={() => setChosen(i)}
            className={`px-3 py-2.5 rounded-xl border text-xs text-left transition-all duration-200
              ${optVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
              ${chosen === null
                ? "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-white/80"
                : chosen === i && i === 1
                  ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                  : chosen === i
                    ? "border-red-500 bg-red-500/15 text-red-300"
                    : i === 1
                      ? "border-emerald-500/30 bg-white/5 text-emerald-400/60 opacity-60"
                      : "border-white/5 bg-white/[0.02] opacity-30 text-white/40"
              }`}
            style={{ transitionDelay: optVisible ? `${i * 80}ms` : "0ms" }}
          >
            <span className="font-mono text-accent-light mr-1.5">{opt[0]}.</span>
            {opt.slice(3)}
          </button>
        ))}
      </div>

      {chosen !== null && (
        <p className={`mt-3 text-xs p-2 rounded-lg ${chosen === 1 ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
          {chosen === 1
            ? "✓ Correcto — los diccionarios guardan pares clave-valor en O(1)."
            : "✗ Incorrecto — la opción B (Diccionario) es la correcta."}
        </p>
      )}
    </div>
  );
}

// ── Static data ──────────────────────────────────────────────────────────────
const STEPS = [
  {
    n: "01",
    title: "Elige un tema",
    desc: "Escribe cualquier tema — un libro, una materia, una tecnología. Sin límites.",
    icon: "🎯",
  },
  {
    n: "02",
    title: "La IA genera al instante",
    desc: "Preguntas de calidad llegan vía streaming en segundos con distractores plausibles.",
    icon: "⚡",
  },
  {
    n: "03",
    title: "Aprende con feedback real",
    desc: "Cada respuesta incluye una explicación detallada. El sistema adapta la dificultad.",
    icon: "🧠",
  },
];

const FEATURES = [
  {
    icon: "📡",
    title: "Streaming en vivo",
    desc: "Las preguntas llegan en tiempo real mientras la IA las genera — sin esperar.",
  },
  {
    icon: "📈",
    title: "Dificultad adaptativa",
    desc: "El sistema ajusta el nivel según tu rendimiento por subtema y racha.",
  },
  {
    icon: "💡",
    title: "Feedback por pregunta",
    desc: "Explicación de por qué cada opción es correcta o incorrecta.",
  },
  {
    icon: "🔥",
    title: "Sistema de rachas",
    desc: "Mantén la racha respondiendo bien para seguir motivado.",
  },
  {
    icon: "🌐",
    title: "Quizzes públicos",
    desc: "Comparte tu sesión con un link para que otros practiquen contigo.",
  },
  {
    icon: "🎛️",
    title: "Multiples proveedores",
    desc: "Respaldado por OpenRouter y Cerebras — alta disponibilidad.",
  },
];

const QUICK_TOPICS = [
  "Historia de Roma", "React Hooks", "Biologia celular",
  "Algebra lineal",   "Marketing digital", "Ciberseguridad",
  "SQL avanzado",     "Fisica cuantica",
];

export function LandingPage({ onGetStarted }: { onGetStarted: () => void }) {
  useSeo({
    title: "QuizDinamico AI | Cuestionarios con IA",
    description:
      "Genera quizzes al instante, aprende con dificultad adaptativa y refuerza conceptos con explicaciones en tiempo real.",
    path: "/",
    robots: "index,follow",
  });

  return (
    <section className="mx-auto w-full max-w-5xl flex-1 flex flex-col gap-16 py-10">

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
        {/* left */}
        <div>
          <p className="mb-4 inline-flex rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold tracking-[0.08em] text-accent-light uppercase">
            Aprendizaje adaptativo con IA
          </p>
          <h1 className="mb-5 text-4xl leading-tight font-heading font-bold text-white md:text-5xl md:leading-[1.07]">
            Domina cualquier tema con quizzes dinámicos
          </h1>
          <p className="max-w-lg text-base text-white/70 md:text-lg mb-8">
            Genera cuestionarios al instante, recibe explicaciones claras y mejora con
            dificultad que se adapta a tu rendimiento.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              onClick={onGetStarted}
              className="inline-flex items-center justify-center rounded-2xl bg-accent px-7 py-4 text-base font-semibold text-white shadow-[0_0_28px_rgba(94,106,210,0.5)] transition-all duration-150 hover:scale-[0.98] hover:bg-accent/90 active:scale-95"
            >
              Empieza gratis →
            </button>
            <p className="text-sm text-white/50">Sin tarjeta de crédito · Registro en 10 s</p>
          </div>
        </div>

        {/* right: live demo (2.1 preview) */}
        <div className="lg:pl-4">
          <DemoCard />
        </div>
      </div>

      {/* ── How it works ─────────────────────────────────────────── */}
      <div>
        <h2 className="text-center text-2xl md:text-3xl font-heading font-bold text-white mb-10">
          ¿Cómo funciona?
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n} className="relative rounded-2xl border border-white/8 bg-white/[0.025] p-6">
              <div className="mb-4 flex items-center gap-3">
                <span className="text-2xl">{step.icon}</span>
                <span className="font-mono text-xs text-accent-light/60 font-bold tracking-widest">{step.n}</span>
              </div>
              <h3 className="font-heading font-semibold text-white text-lg mb-2">{step.title}</h3>
              <p className="text-sm text-white/60 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Features grid ────────────────────────────────────────── */}
      <div>
        <h2 className="text-center text-2xl md:text-3xl font-heading font-bold text-white mb-10">
          Todo lo que necesitas para aprender mejor
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article key={f.title} className="rounded-2xl border border-white/8 bg-white/[0.025] p-5 hover:bg-white/[0.04] hover:border-white/12 transition-all duration-200">
              <span className="text-3xl mb-3 block">{f.icon}</span>
              <h3 className="font-heading font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-white/60 leading-relaxed">{f.desc}</p>
            </article>
          ))}
        </div>
      </div>

      {/* ── Quick topics ─────────────────────────────────────────── */}
      <div className="rounded-3xl border border-white/8 bg-[var(--color-surface-glass)] p-6 md:p-8">
        <p className="text-sm text-white/50 text-center mb-5 font-medium">
          Algunos temas populares para empezar
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {QUICK_TOPICS.map((t) => (
            <button
              key={t}
              onClick={onGetStarted}
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/70 transition-all hover:border-accent/40 hover:text-white hover:bg-accent/10"
            >
              {t}
            </button>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-8 text-center">
          <button
            onClick={onGetStarted}
            className="inline-flex items-center justify-center rounded-2xl bg-accent px-7 py-4 text-base font-semibold text-white shadow-[0_0_24px_rgba(94,106,210,0.4)] transition-all duration-150 hover:scale-[0.98] hover:bg-accent/90 active:scale-95"
          >
            Crear mi primer quiz gratis
          </button>
        </div>
      </div>

    </section>
  );
}
