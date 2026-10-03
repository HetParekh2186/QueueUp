"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, loadAuth, saveAuth } from "./api";
import type { TokenResponse, User } from "./types";

type AuthState = {
  user: User | null;
  ready: boolean;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
  /** Re-read the current user (e.g. after requesting or being granted a role). */
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      const auth = loadAuth();
      setUser(auth?.user ?? null);
      setToken(auth?.access_token ?? null);
      setReady(true);
    };
    sync();
    window.addEventListener("queueup-auth", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("queueup-auth", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    saveAuth(await api<TokenResponse>("/auth/login", { method: "POST", body: { email, password }, auth: false }));
  }, []);

  const signup = useCallback(async (email: string, password: string, display_name: string) => {
    saveAuth(
      await api<TokenResponse>("/auth/signup", {
        method: "POST",
        body: { email, password, display_name },
        auth: false,
      }),
    );
  }, []);

  const logout = useCallback(() => saveAuth(null), []);

  const refreshUser = useCallback(async () => {
    const auth = loadAuth();
    if (!auth) return;
    try {
      const fresh = await api<User>("/auth/me");
      const latest = loadAuth(); // tokens may have been refreshed meanwhile
      if (latest) saveAuth({ ...latest, user: fresh });
    } catch {
      /* offline or logged out: keep what we have */
    }
  }, []);

  // Roles live on the server and can change at any time (an admin approves you), so
  // re-read the user once per page load instead of trusting the copy from login.
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  return (
    <AuthContext.Provider value={{ user, ready, token, login, signup, logout, refreshUser }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
