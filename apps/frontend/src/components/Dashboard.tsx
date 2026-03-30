import React, { useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { api } from "../lib/apiClient";
import { useSeo } from "../lib/seo";

export function Dashboard({ onStartSession }: { onStartSession: (id: string) => void }) {
  const { logout } = useAuth();
  const [topic, setTopic] = useState("");
  const [questionCount, setQuestionCount] = useState(5);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useSeo({
    title: "Dashboard | QuizDinamico AI",
    description:
      "Crea una nueva sesion, elige un tema y genera preguntas con IA en segundos.",
    path: "/app",
    robots: "noindex,follow"
  });

  const handleStart = async () => {
    if (isLoading) {
      return;
    }

    if (!topic.trim()) {
      setError("Introduce un tema");
      return;
    }
    
    setIsLoading(true);
    setError("");

    try {
      const session = await api.json("/sessions", {
        method: "POST",
        body: JSON.stringify({ topic })
      });
      await api.json(`/sessions/${session.id}/rounds`, {
        method: "POST",
        body: JSON.stringify({ count: questionCount })
      });
      onStartSession(session.id);
    } catch (err: any) {
      setError(err.message || "No se pudo iniciar el quiz");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-4">
      <div className="w-full max-w-2xl p-8 rounded-3xl bg-[var(--color-surface-glass)] backdrop-blur-xl border border-white/10 shadow-2xl relative overflow-hidden">
        
        {/* Top bar */}
        <div className="absolute top-4 right-4">
          <button 
            onClick={logout}
            className="text-sm px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors border border-white/5"
          >
            Cerrar sesion
          </button>
        </div>

        <div className="text-center mt-8 mb-10">
          <h1 className="text-balance text-4xl md:text-5xl font-heading font-bold mb-4 bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
            Que quieres aprender hoy?
          </h1>
          <p className="text-white/60">Genera un quiz con IA sobre cualquier tema en segundos.</p>
        </div>

        <div className="mb-8 flex flex-wrap justify-center gap-2">
          {["Historia", "Python", "Anatomia", "Finanzas", "Geografia", "UX"].map((seed) => (
            <button
              key={seed}
              onClick={() => setTopic(seed)}
              className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/75 transition hover:border-white/30 hover:text-white"
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

        <div className="space-y-8 max-w-xl mx-auto">
          {/* Large Topic Input */}
          <div className="relative">
            <label htmlFor="topic-input" className="sr-only">
              Tema del cuestionario
            </label>
            <input 
              id="topic-input"
              value={topic} 
              onChange={e => setTopic(e.target.value)} 
              placeholder="Ej: Imperio romano, React Hooks, Fisica cuantica" 
              className="w-full px-6 py-5 text-lg rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-accent transition-all duration-150 shadow-inner"
              onKeyDown={e => {
                if (e.key === 'Enter') handleStart();
              }}
            />
          </div>

          {/* Question Count Selector */}
          <div>
            <label className="block text-sm font-medium text-white/50 text-center mb-3">
              Numero de preguntas
            </label>
            <div className="flex justify-center gap-3">
              {[5, 10, 15].map(count => (
                <button
                  key={count}
                  onClick={() => setQuestionCount(count)}
                  className={`px-6 py-2 rounded-full border transition-all duration-200 ${
                    questionCount === count 
                      ? "bg-accent/20 border-accent text-accent" 
                      : "bg-transparent border-white/10 text-white/60 hover:border-white/30 hover:text-white"
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <button 
            onClick={handleStart}
            disabled={isLoading || !topic.trim()}
            className="w-full py-4 rounded-2xl bg-accent hover:bg-accent/90 text-white font-semibold text-lg shadow-[0_0_20px_rgba(94,106,210,0.3)] hover:shadow-[0_0_30px_rgba(94,106,210,0.5)] hover:scale-[0.98] active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-3"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Generando quiz...
              </>
            ) : "Generar quiz"}
          </button>
        </div>

      </div>
    </div>
  );
}
