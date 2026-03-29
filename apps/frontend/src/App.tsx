import React, { useState } from "react";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { Login } from "./components/Login";
import { Dashboard } from "./components/Dashboard";
import { QuizRunner } from "./components/QuizRunner";

function Main() {
  const { isAuthenticated } = useAuth();
  const [activeSession, setActiveSession] = useState<string | null>(null);

  if (!isAuthenticated) return <Login />;

  if (activeSession) {
    return <QuizRunner sessionId={activeSession} onBack={() => setActiveSession(null)} />;
  }

  return <Dashboard onStartSession={setActiveSession} />;
}

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen relative overflow-hidden bg-[var(--color-bg-base)] text-white font-sans selection:bg-accent/30 selection:text-accent-light">
        
        {/* Ambient Light Blobs */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
          <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-accent/20 rounded-full blur-[120px] mix-blend-screen opacity-50 animate-[pulse_8s_ease-in-out_infinite]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-success/10 rounded-full blur-[150px] mix-blend-screen opacity-40 animate-[pulse_10s_ease-in-out_infinite_reverse]" />
          <div className="absolute top-[40%] left-[60%] w-[400px] h-[400px] bg-accent/15 rounded-full blur-[100px] mix-blend-screen opacity-30" />
        </div>

        {/* Content Layer */}
        <main className="relative z-10 w-full min-h-screen pt-12 pb-24 px-4 sm:px-6 lg:px-8 flex flex-col antialiased">
          <Main />
        </main>
        
      </div>
    </AuthProvider>
  );
}
