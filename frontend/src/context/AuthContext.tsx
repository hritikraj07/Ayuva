import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  role: "patient" | "doctor" | "admin";
  specialty_or_department?: string | null;
  created_at: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isReady: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (payload: {
    email: string;
    password: string;
    full_name: string;
    role: "patient" | "doctor" | "admin";
    specialty_or_department?: string;
  }) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const persistSession = (nextToken: string, nextUser: AuthUser) => {
    localStorage.setItem("ayuva_auth", JSON.stringify({ token: nextToken, user: nextUser }));
    setToken(nextToken);
    setUser(nextUser);
  };

  const logout = useCallback(() => {
    localStorage.removeItem("ayuva_auth");
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    const restore = async () => {
      try {
        const raw = localStorage.getItem("ayuva_auth");
        if (!raw) {
          setIsReady(true);
          return;
        }
        const parsed = JSON.parse(raw);
        if (!parsed?.token) {
          setIsReady(true);
          return;
        }
        setToken(parsed.token);
        const me = await apiFetch<AuthUser>("/auth/me");
        persistSession(parsed.token, me);
      } catch {
        logout();
      } finally {
        setIsReady(true);
      }
    };
    restore();
  }, [logout]);

  const login = async (email: string, password: string): Promise<AuthUser> => {
    const data = await apiFetch<{ access_token: string; user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    persistSession(data.access_token, data.user);
    return data.user;
  };

  const register = async (payload: {
    email: string;
    password: string;
    full_name: string;
    role: "patient" | "doctor" | "admin";
    specialty_or_department?: string;
  }): Promise<AuthUser> => {
    const data = await apiFetch<{ access_token: string; user: AuthUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    persistSession(data.access_token, data.user);
    return data.user;
  };

  return (
    <AuthContext.Provider value={{ user, token, isReady, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
