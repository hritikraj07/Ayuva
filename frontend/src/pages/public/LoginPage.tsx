import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock, LogIn } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldLabel, Input } from "@/components/ui/primitives";
import { useAuth } from "@/context/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const loggedInUser = await login(email, password);
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

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/">
            <BrandMark />
          </Link>
          <Link to="/register" className="text-sm font-medium text-secondary hover:underline">
            Need an account? Register
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12 sm:px-6">
        <Card>
          <CardHeader>
            <div className="mb-1 inline-flex w-fit items-center gap-1.5 rounded bg-secondary px-2.5 py-1 text-xs font-semibold text-primary">
              <Lock className="size-3.5 text-secondary" aria-hidden="true" />
              <span>Authenticated Access</span>
            </div>
            <CardTitle className="text-xl">Sign in to MedLedger</CardTitle>
            <CardDescription>
              Access your personal health vault, clinician share sessions, or public-health surveillance workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
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

            <div className="mt-5 border-t border-border pt-4 text-center text-xs text-muted-foreground">
              New user?{" "}
              <Link to="/register" className="font-semibold text-secondary hover:underline">
                Create a fresh Patient, Doctor, or Public Health Admin account
              </Link>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
