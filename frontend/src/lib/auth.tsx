import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { fetchMe, login as apiLogin, logout as apiLogout } from "./api";
import type { AuthUserDto } from "./api";
import type { Role, UserProfile } from "../types";

const TOKEN_KEY = "dynamiq-auth-token";

function avatarInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function toProfile(dto: AuthUserDto): UserProfile {
  return { id: dto.user_id, name: dto.name, email: dto.email, role: dto.role as Role, avatarInitials: avatarInitials(dto.name) };
}

interface AuthContextValue {
  user: UserProfile | null;
  orgId: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    fetchMe(token)
      .then((dto) => {
        setUser(toProfile(dto));
        setOrgId(dto.org_id);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
      })
      .finally(() => setLoading(false));
  }, []);

  async function signIn(email: string, password: string) {
    const { token, user: dto } = await apiLogin(email, password);
    localStorage.setItem(TOKEN_KEY, token);
    setUser(toProfile(dto));
    setOrgId(dto.org_id);
  }

  function signOut() {
    const token = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setOrgId(null);
    if (token) apiLogout(token).catch(() => {});
  }

  const value = useMemo(() => ({ user, orgId, loading, signIn, signOut }), [user, orgId, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
