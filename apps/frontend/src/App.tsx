import React, { useMemo, useState } from "react";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { Login } from "./components/Login";
import { Dashboard } from "./components/Dashboard";
import { QuizRunner } from "./components/QuizRunner";
import { LandingPage } from "./components/LandingPage";
import { PublicQuizPage } from "./components/PublicQuizPage";

type Route =
  | { name: "home" }
  | { name: "login" }
  | { name: "app" }
  | { name: "publicQuiz"; sessionId: string };

function parseRouteFromPath(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { name: "home" };
  if (pathname === "/login") return { name: "login" };
  if (pathname === "/app") return { name: "app" };

  const quizMatch = pathname.match(/^\/quiz\/([a-zA-Z0-9-]+)(?:\/[a-z0-9-]+)?$/);
  if (quizMatch?.[1]) {
    return { name: "publicQuiz", sessionId: quizMatch[1] };
  }

  return { name: "home" };
}

function navigate(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function Main() {
  const { isAuthenticated } = useAuth();
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [path, setPath] = useState(() => window.location.pathname);

  React.useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const route = useMemo(() => parseRouteFromPath(path), [path]);

  const startSession = (sessionId: string) => {
    setActiveSession(sessionId);
    navigate("/app");
  };

  React.useEffect(() => {
    if (isAuthenticated && route.name === "home") {
      navigate("/app");
      return;
    }

    if (isAuthenticated && route.name === "login") {
      navigate("/app");
      return;
    }

    if (!isAuthenticated && route.name === "app") {
      navigate("/login");
    }
  }, [isAuthenticated, route.name]);

  if (route.name === "publicQuiz") {
    return <PublicQuizPage sessionId={route.sessionId} onGoToApp={() => navigate("/login")} />;
  }

  if (route.name === "home") {
    if (isAuthenticated) {
      if (activeSession) {
        return <QuizRunner sessionId={activeSession} onBack={() => setActiveSession(null)} />;
      }
      return <Dashboard onStartSession={startSession} />;
    }
    return <LandingPage onGetStarted={() => navigate("/login")} />;
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  if (route.name === "login") return <Dashboard onStartSession={startSession} />;

  if (activeSession) {
    return <QuizRunner sessionId={activeSession} onBack={() => setActiveSession(null)} />;
  }

  return <Dashboard onStartSession={startSession} />;
}

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen relative overflow-hidden bg-[var(--color-bg-base)] text-white font-sans selection:bg-accent/30 selection:text-accent-light">
        <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
          <div className="gpu-layer absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-accent/20 rounded-full blur-[120px] mix-blend-screen animate-[pulse-soft_8s_ease-in-out_infinite]" />
          <div className="gpu-layer absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-success/10 rounded-full blur-[150px] mix-blend-screen animate-[pulse-soft_10s_ease-in-out_infinite_reverse]" />
          <div className="gpu-layer absolute top-[40%] left-[60%] w-[400px] h-[400px] bg-accent/15 rounded-full blur-[100px] mix-blend-screen opacity-30" />
        </div>

        <main className="relative z-10 w-full min-h-screen pt-8 pb-16 px-4 sm:px-6 lg:px-8 flex flex-col antialiased">
          <Main />
        </main>
      </div>
    </AuthProvider>
  );
}
