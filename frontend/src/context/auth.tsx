"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import api from "@/lib/axios";

export interface AuthUser {
  id: number;
  username: string;
  role: "admin" | "annotator";
  trust_score: number;
  is_active: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      setIsLoading(false);
      return;
    }
    api
      .get<AuthUser>("/api/auth/me")
      .then((res) => setUser(res.data))
      .catch(() => localStorage.removeItem("access_token"))
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<AuthUser> => {
    const { data } = await api.post<{ access_token: string }>("/api/auth/login", {
      username,
      password,
    });
    localStorage.setItem("access_token", data.access_token);
    const { data: me } = await api.get<AuthUser>("/api/auth/me");
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("access_token");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
