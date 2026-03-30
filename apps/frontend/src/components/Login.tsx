import React, { useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { api } from "../lib/apiClient";
import { useSeo } from "../lib/seo";

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const emailLabel = "Correo electronico";
  const passwordLabel = "Contrasena";

  useSeo({
    title: isRegister
      ? "Crear cuenta | QuizDinamico AI"
      : "Iniciar sesion | QuizDinamico AI",
    description:
      "Accede a tu panel para generar quizzes con IA, practicar y mejorar con dificultad adaptativa.",
    path: "/login",
    robots: "noindex,follow"
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const endpoint = isRegister ? "/auth/register" : "/auth/login";
      const data = await api.json(endpoint, {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      login(data.accessToken, data.refreshToken);
    } catch (err: any) {
      setError(err.message || "Ocurrio un error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center p-4">
      <div className="w-full max-w-md p-8 rounded-2xl bg-[var(--color-surface-glass)] backdrop-blur-xl border border-white/10 shadow-2xl">
        <h2 className="text-3xl font-heading font-bold text-center mb-6">
          {isRegister ? "Crea tu cuenta" : "Bienvenido de nuevo"}
        </h2>
        
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email-input" className="block text-sm font-medium text-white/70 mb-1">{emailLabel}</label>
            <input 
              id="email-input"
              type="email" 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              placeholder="you@example.com" 
              required 
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-accent transition-all duration-150"
            />
          </div>
          <div>
            <label htmlFor="password-input" className="block text-sm font-medium text-white/70 mb-1">{passwordLabel}</label>
            <input 
              id="password-input"
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              placeholder="••••••••" 
              required 
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-accent transition-all duration-150"
            />
          </div>
          
          <button 
            type="submit" 
            disabled={isLoading}
            className="w-full py-3 mt-4 rounded-xl bg-accent hover:bg-accent/90 text-white font-semibold shadow-lg hover:shadow-accent/25 hover:scale-[0.98] active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none"
          >
            {isLoading ? "Un momento..." : (isRegister ? "Registrarme" : "Entrar")}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            onClick={() => setIsRegister(!isRegister)}
            className="text-sm text-white/60 hover:text-white transition-colors duration-150"
          >
            {isRegister ? "Ya tienes cuenta? Inicia sesion" : "No tienes cuenta? Registrate"}
          </button>
        </div>
      </div>
    </div>
  );
}
