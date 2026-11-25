import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock, LogIn, ShieldCheck, Stethoscope, User } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldLabel, Input } from "@/components/ui/primitives";
import { useAuth } from "@/context/AuthContext";

const DEMO_ACCOUNTS = [
  {
    label: "Demo Patient",
    role: "patient",
    email: "patient@medledger.demo",
    password: "Patient@2026",
    note: "Starts with empty vault",
    icon: User,
  },
  {
    label: "Demo Doctor",
    role: "doctor",
    email: "doctor@medledger.demo",
    password: "Doctor@2026",
    note: "Scoped record viewer",
    icon: Stethoscope,
  },
  {
    label: "Demo Admin",
    role: "admin",
    email: "admin@medledger.demo",
    password: "Admin@2026",
    note: "Live NCDC sync & SEIR",
    icon: ShieldCheck,
  },
] as const;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performLogin = async (targetEmail: string, targetPassword: string) => {
    setError(null);
    setLoading(true);
    try {
      const loggedInUser = await login(targetEmail, targetPassword);
      const target =
        loggedInUser.role === "admin"
          ? "/admin/overview"
          : loggedInUser.role === "doctor"
          ? "/doctor/records"
          : "/patient/overview";
      navigate(target);
    } catch (err: any) {
      setError(err?.message || "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performLogin(email, password);
  };

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-slate-300/80 bg-secondary/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/">
            <BrandMark />
          </Link>
          <Link to="/register" className="text-sm font-semibold text-primary hover:underline">
            Need an account? Register
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10 sm:px-6">
        <Card>
          <CardHeader>
            <div className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-md border border-[#66A9EC]/50 bg-card px-2.5 py-1 text-xs font-semibold text-primary">
              <Lock className="size-3.5 text-[#0284C7]" aria-hidden="true" />
              <span>Authenticated Access</span>
            </div>
            <CardTitle className="text-xl">Sign in to MedLedger</CardTitle>
            <CardDescription>
              Access your personal health vault, clinician share sessions, or public-health surveillance workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <Alert variant="danger" title="Authentication Failed">
                  {error}
                </Alert>
              )}
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="login-email">Email Address</FieldLabel>
                <Input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@organization.org"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="login-password">Password</FieldLabel>
                <Input
                  id="login-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                />
              </div>
              <Button type="submit" disabled={loading} className="mt-1 w-full">
                <LogIn className="size-4" aria-hidden="true" />
                <span>{loading ? "Signing in..." : "Sign In"}</span>
              </Button>
            </form>

            {/* Clean Optional Demo Sign-In Section (Zero fabricated records) */}
            <div className="border-t border-slate-200 pt-4">
              <div className="mb-2.5 flex items-center justify-between text-xs">
                <span className="font-semibold text-primary">Quick Demo Sign In</span>
                <span className="text-[11px] text-muted-foreground">Clean slate (no mock records)</span>
              </div>
              <div className="grid gap-2">
                {DEMO_ACCOUNTS.map((acc) => {
                  const Icon = acc.icon;
                  return (
                    <button
                      key={acc.email}
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        setEmail(acc.email);
                        setPassword(acc.password);
                        performLogin(acc.email, acc.password);
                      }}
                      className="flex min-h-[44px] items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs transition-colors hover:border-[#66A9EC] hover:bg-card disabled:opacity-50"
                    >
                      <span className="flex items-center gap-2 font-semibold text-primary">
                        <Icon className="size-4 text-[#0284C7]" aria-hidden="true" />
                        <span>{acc.label}</span>
                      </span>
                      <span className="text-[11px] text-muted-foreground">{acc.note}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-slate-200 pt-3 text-center text-xs text-muted-foreground">
              New user?{" "}
              <Link to="/register" className="font-semibold text-primary hover:underline">
                Create a fresh Patient, Doctor, or Admin account
              </Link>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
