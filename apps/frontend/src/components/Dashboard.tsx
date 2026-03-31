import React, { useEffect, useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { api } from "../lib/apiClient";
import { useSeo } from "../lib/seo";

type DifficultyOption = "EASY" | "MEDIUM" | "HARD";

type SessionItem = {
  id: string;
  topic: string;
  createdAt: string;
  currentDifficulty: DifficultyOption;
  status: string;
  rounds: Array<{
    id: string;
    roundIndex: number;
    status: string;
    requestedCount: number;
    generatedCount: number;
    requestedDifficulty: DifficultyOption;
    createdAt: string;
  }>;
};

const DIFFICULTY_META: Record<DifficultyOption, { label: string; active: string }> = {
  EASY:   { label: "Fácil",   active: "bg-emerald-500/15 border-emerald-500/40 text-emerald-400" },
  MEDIUM: { label: "Media",   active: "bg-accent/15 border-accent/40 text-accent-light" },
  HARD:   { label: "Difícil", active: "bg-red-500/15 border-red-500/40 text-red-400" },
};

const BADGE_CLASSES: Record<DifficultyOption, string> = {
  EASY:   "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
  MEDIUM: "bg-accent/10 border-accent/30 text-accent-light",
  HARD:   "bg-red-500/10 border-red-500/30 text-red-400",
};

const QUICK_TOPICS = ["Historia", "Python", "Anatomia", "Finanzas", "Geografia", "UX"];

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 7)  return `Hace ${days} días`;
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(new Date(iso));
}

export function Dashboard({ onStartSession }: { onStartSession: (id: string) => void }) {
  const { logout } = useAuth();
  const [topic, setTopic]                     = useState("");
  const [questionCount, setQuestionCount]     = useState<5 | 10 | 15>(5);
  const [difficulty, setDifficulty]           = useState<DifficultyOption>("MEDIUM");
  const [isLoading, setIsLoading]             = useState(false);
  const [error, setError]                     = useState("");
  const [userStreak, setUserStreak]           = useState<number | null>(null);
  const [sessions, setSessions]               = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  useSeo({
    title: "Dashboard | QuizDinamico AI",
    description: "Crea una nueva sesion, elige un tema y genera preguntas con IA en segundos.",
    path: "/app",
    robots: "noindex,follow",
  });

  useEffect(() => {
    api.json("/auth/me")
      .then((d: any) => setUserStreak(d.currentStreak))
      .catch(() => {});
    api.json("/sessions")
      .then((d: any) => setSessions(Array.isArray(d) ? d : []))
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
  }, []);

  const handleStart = async () => {
    if (isLoading) return;
    if (!topic.trim()) { setError("Introduce un tema"); return; }
    setIsLoading(true);
    setError("");
    try {
      const session = await api.json("/sessions", {
        method: "POST",
        body: JSON.stringify({ topic }),
      });
      await api.json(`/sessions/${session.id}/rounds`, {
        method: "POST",
        body: JSON.stringify({ count: questionCount, difficulty }),
      });
      onStartSession(session.id);
    } catch (err: any) {
      setError(err.message || "No se pudo iniciar el quiz");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center min-h-[80vh] p-4 gap-8 max-w-2xl mx-auto w-full">

      {/* ── Create card ─────────────────────────────────────────── */}
      <div className="w-full p-8 rounded-3xl bg-[var(--color-surface-glass)] backdrop-blur-xl border border-white/10 shadow-2xl relative overflow-hidden">

        {/* top-right: logout */}
        <div className="absolute top-4 right-4">
          <button
            onClick={logout}
            className="text-sm px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors border border-white/5"
          >
            Cerrar sesion
          </button>
        </div>

        {/* top-left: streak */}
        {userStreak !== null && userStreak > 0 && (
          <div className="absolute top-4 left-4">
            <div className="px-4 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 font-mono font-bold animate-pulse shadow-[0_0_15px_rgba(249,115,22,0.2)]">
              🔥 Racha {userStreak}
            </div>
          </div>
        )}

        {/* heading */}
        <div className="text-center mt-8 mb-10">
          <h1 className="text-balance text-4xl md:text-5xl font-heading font-bold mb-4 bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            Que quieres aprender hoy?
          </h1>
          <p className="text-white/60">Genera un quiz con IA sobre cualquier tema en segundos.</p>
        </div>

        {/* quick topics */}
        <div className="mb-8 flex flex-wrap justify-center gap-2">
          {QUICK_TOPICS.map((seed) => (
            <button
              key={seed}
              onClick={() => setTopic(seed)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-all hover:border-white/30 hover:text-white ${
                topic === seed
                  ? "border-accent/50 bg-accent/10 text-accent-light"
                  : "border-white/15 bg-white/5 text-white/75"
              }`}
            >
              {seed}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm text-center">
            {error}
          </div>
        )}

        <div className="space-y-6 max-w-xl mx-auto">
          {/* topic input */}
          <div>
            <label htmlFor="topic-input" className="sr-only">Tema del cuestionario</label>
            <input
              id="topic-input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Ej: Imperio romano, React Hooks, Fisica cuantica"
              className="w-full px-6 py-5 text-lg rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-accent transition-all duration-150 shadow-inner"
              onKeyDown={(e) => { if (e.key === "Enter") handleStart(); }}
            />
          </div>

          {/* count + difficulty row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* count */}
            <div>
              <p className="text-sm font-medium text-white/50 text-center mb-3">Preguntas</p>
              <div className="flex justify-center gap-2">
                {([5, 10, 15] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => setQuestionCount(n)}
                    className={`px-5 py-2 rounded-full border transition-all duration-200 ${
                      questionCount === n
                        ? "bg-accent/20 border-accent text-accent"
                        : "border-white/10 text-white/60 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* difficulty (3.4) */}
            <div>
              <p className="text-sm font-medium text-white/50 text-center mb-3">Dificultad inicial</p>
              <div className="flex justify-center gap-2">
                {(["EASY", "MEDIUM", "HARD"] as DifficultyOption[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={`px-3 py-2 rounded-full border text-xs font-semibold transition-all duration-200 ${
                      difficulty === d
                        ? DIFFICULTY_META[d].active
                        : "border-white/10 text-white/60 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    {DIFFICULTY_META[d].label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* generate */}
          <button
            onClick={handleStart}
            disabled={isLoading || !topic.trim()}
            className="w-full py-4 rounded-2xl bg-accent hover:bg-accent/90 text-white font-semibold text-lg shadow-[0_0_20px_rgba(94,106,210,0.3)] hover:shadow-[0_0_30px_rgba(94,106,210,0.5)] hover:scale-[0.98] active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-3"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Generando quiz...
              </>
            ) : "✨  Generar quiz"}
          </button>
        </div>
      </div>

      {/* ── Session history (1.1) ────────────────────────────────── */}
      <section className="w-full" aria-labelledby="recent-sessions-heading">
        <h2 id="recent-sessions-heading" className="text-xs font-semibold text-white/60 uppercase tracking-widest mb-4 px-1">
          Sesiones recientes
        </h2>

        {sessionsLoading ? (
          <div className="space-y-3" aria-hidden="true">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-[68px] rounded-2xl bg-white/[0.03] border border-white/5 animate-pulse motion-reduce:animate-none" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 text-center text-white/60 text-sm">
            Todavía no tienes sesiones. ¡Crea tu primer quiz arriba!
          </div>
        ) : (
          <ul role="list" className="space-y-3">
            {sessions.slice(0, 6).map((session) => {
              const lastRound = session.rounds[0];
              const diff: DifficultyOption =
                lastRound?.requestedDifficulty ?? session.currentDifficulty ?? "MEDIUM";
              return (
                <li
                  key={session.id}
                  className="group flex items-center justify-between gap-4 p-4 rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/15 transition-all motion-reduce:transition-none duration-150"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{session.topic}</p>
                    <p className="text-xs text-white/60 mt-0.5">
                      {formatRelativeDate(session.createdAt)}
                      {lastRound && ` · Ronda ${lastRound.roundIndex}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`hidden sm:inline text-xs px-2.5 py-1 rounded-full border font-semibold ${BADGE_CLASSES[diff]}`}>
                      {DIFFICULTY_META[diff].label}
                    </span>
                    <button
                      onClick={() => onStartSession(session.id)}
                      aria-label={`Continuar sesión de ${session.topic}`}
                      className="flex items-center justify-center min-h-[44px] min-w-[44px] text-sm px-4 py-1.5 rounded-xl bg-accent/10 border border-accent/20 text-accent-light hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e1e2f] transition-all motion-reduce:transition-none duration-150"
                    >
                      Continuar →
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
