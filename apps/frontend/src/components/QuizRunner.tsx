import React, { useState } from "react";
import { api } from "../lib/apiClient";
import { useQuizStream } from "../lib/useQuizStream";

export function QuizRunner({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const { questions, status, error } = useQuizStream(sessionId);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [streak, setStreak] = useState(0);

  const handleAttempt = async (qId: string, option: string) => {
    try {
      const result = await api.json(`/sessions/${sessionId}/questions/${qId}/attempt`, {
        method: "POST",
        body: JSON.stringify({
          attemptId: `${sessionId}-${qId}-${Date.now()}`,
          selectedOption: option
        })
      });
      setAnswers(prev => ({ ...prev, [qId]: { ...result.feedback, selectedOption: option } }));
      
      if (result.feedback.isCorrect) {
        setStreak(s => s + 1);
      } else {
        setStreak(0);
      }

    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="flex flex-col items-center min-h-[90vh] p-4 max-w-4xl mx-auto w-full">
      
      {/* Top Header */}
      <header className="flex w-full items-center justify-between mb-8">
        <button 
          onClick={onBack}
          className="text-white/60 hover:text-white px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors border border-white/5"
        >
          ← Quit
        </button>

        {/* Streak Counter */}
        {streak > 0 && (
          <div className="px-4 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 font-mono font-bold animate-pulse">
            🔥 {streak} Streak
          </div>
        )}

        <div className="text-white/40 font-mono">
          Session ID: {sessionId.slice(0, 8)}...
        </div>
      </header>

      {/* Global Errors */}
      {error && (
        <div className="w-full mb-6 p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-center shadow-lg">
          Connection Error: {error}. Please refresh or try again.
        </div>
      )}

      {/* Status Bar */}
      <div className="w-full h-1 bg-white/5 rounded-full mb-8 overflow-hidden">
        {status === "CONNECTING" && (
          <div className="h-full bg-accent/50 w-1/4 animate-[pulse_2s_ease-in-out_infinite] rounded-full" />
        )}
      </div>

      {/* Questions Stack */}
      <div className="w-full space-y-8">
        
        {/* Skeleton Loader while connecting/generating */}
        {status === "CONNECTING" && questions.length === 0 && (
          <div className="w-full p-8 rounded-3xl bg-[var(--color-surface-glass)] backdrop-blur-md border border-white/5 animate-pulse">
            <div className="h-6 bg-white/10 rounded w-3/4 mb-8" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="h-16 bg-white/5 rounded-2xl" />
              <div className="h-16 bg-white/5 rounded-2xl" />
              <div className="h-16 bg-white/5 rounded-2xl" />
              <div className="h-16 bg-white/5 rounded-2xl" />
            </div>
          </div>
        )}

        {questions.map((q: any) => {
          const answer = answers[q.id];
          const isAnswered = !!answer;

          return (
            <div 
              key={q.id} 
              className={`w-full p-6 md:p-8 rounded-3xl bg-[var(--color-bg-elevated)] border border-white/10 shadow-2xl transition-all duration-300 ${
                isAnswered ? "opacity-100" : "animate-in slide-in-from-bottom-4 fade-in"
              }`}
            >
              <h3 className="text-xl md:text-2xl font-heading font-medium text-white mb-6 leading-relaxed">
                {q.questionText}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(q.options).map(([key, value]) => {
                  
                  // Styling logic for options based on state
                  let btnStyle = "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 text-white";
                  if (isAnswered) {
                    if (answer.selectedOption === key) {
                      btnStyle = answer.isCorrect 
                        ? "bg-success/20 border-success text-success shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                        : "bg-danger/20 border-danger text-danger shadow-[0_0_15px_rgba(239,68,68,0.3)]";
                    } else if (key === answer.correctOption) { // If there's a correctOption property we could highlight it, but we only have boolean and explanation. Let's rely on explanation or keep it dim
                      btnStyle = "bg-white/5 border-success/30 text-success/50 opacity-60";
                    } else {
                      btnStyle = "bg-white/5 border-white/5 opacity-40 grayscale";
                    }
                  }

                  return (
                    <button 
                      key={key} 
                      onClick={() => handleAttempt(q.id, key)}
                      disabled={isAnswered}
                      className={`relative flex items-center p-4 rounded-2xl border text-left transition-all duration-150 ease-out select-none
                        ${!isAnswered ? "hover:scale-[0.98] active:scale-95 cursor-pointer" : "cursor-default"}
                        ${btnStyle}
                      `}
                    >
                      <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 text-sm font-bold font-mono mr-4">
                        {key}
                      </span>
                      <span className="font-sans leading-tight text-lg">
                        {value as string}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Feedback Slide-in Panel */}
              {answer && (
                <div className={`mt-6 p-5 rounded-2xl border animate-in slide-in-from-top-2 fade-in ${
                  answer.isCorrect 
                    ? "bg-success/10 border-success/20 text-success-light" 
                    : "bg-danger/10 border-danger/20 text-danger-light"
                }`}>
                  <div className="flex items-center gap-3 mb-2 font-heading font-bold text-lg">
                    {answer.isCorrect ? (
                      <><span className="text-2xl">🎉</span> Correct!</>
                    ) : (
                      <><span className="text-2xl">💡</span> Not quite...</>
                    )}
                  </div>
                  <p className="text-white/80 leading-relaxed font-sans">
                    {answer.explanation}
                  </p>
                </div>
              )}
            </div>
          );
        })}
        
        {/* Completion State */}
        {status === "DONE" && (
          <div className="w-full p-8 text-center rounded-3xl bg-accent/10 border border-accent/30 shadow-[0_0_40px_rgba(94,106,210,0.2)] animate-in zoom-in fade-in duration-500 mt-8">
            <h2 className="text-3xl font-heading font-bold text-white mb-4">Round Complete!</h2>
            <p className="text-white/60 mb-8 text-lg">You've finished all the generated questions.</p>
            <button 
              onClick={onBack}
              className="px-8 py-4 rounded-xl bg-accent hover:bg-accent/90 text-white font-bold shadow-lg hover:shadow-accent/50 hover:scale-105 transition-all duration-200"
            >
              Start New Round
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
