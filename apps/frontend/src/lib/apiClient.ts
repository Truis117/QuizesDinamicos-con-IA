const DEFAULT_DEV_API_URL = "http://localhost:3000/api";

export const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? DEFAULT_DEV_API_URL : "/api");

export class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    this.refreshToken = localStorage.getItem("refresh_token");
    this.accessToken = localStorage.getItem("access_token");
  }

  setTokens(access: string, refresh: string) {
    this.accessToken = access;
    this.refreshToken = refresh;
    localStorage.setItem("access_token", access);
    localStorage.setItem("refresh_token", refresh);
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
  }

  get hasRefreshToken() {
    return !!this.refreshToken;
  }

  async fetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    if (this.accessToken) {
      headers.set("Authorization", `Bearer ${this.accessToken}`);
    }
    if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    let res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });

    if (res.status === 401 && this.refreshToken) {
      const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      if (refreshRes.ok) {
        const data = await refreshRes.json();
        this.setTokens(data.accessToken, data.refreshToken);
        headers.set("Authorization", `Bearer ${data.accessToken}`);
        res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
      } else {
        this.clearTokens();
        throw new Error("Session expired");
      }
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || res.statusText);
    }

    return res;
  }

  async json(endpoint: string, options: RequestInit = {}) {
    const res = await this.fetch(endpoint, options);
    return res.json();
  }
}

export const api = new ApiClient();
