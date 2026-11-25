import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Lock, ShieldCheck, Stethoscope, User } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldLabel, Input } from "@/components/ui/primitives";
import { useAuth } from "@/context/AuthContext";

const DEMO_ACCOUNTS = [
  {
    label: "Demo Patient",
    role: "patient",
    email: "patient@ayuva.demo",
    password: "Patient@2026",
    note: "Starts with empty vault",
    icon: User,
  },
  {
    label: "Demo Doctor",
    role: "doctor",
    email: "doctor@ayuva.demo",
    password: "Doctor@2026",
    note: "Scoped record viewer",
    icon: Stethoscope,
  },
  {
    label: "Demo Admin",
    role: "admin",
    email: "admin@ayuva.demo",
    password: "Admin@2026",
    note: "Live NCDC sync & SEIR",
    icon: ShieldCheck,
  },
] as const;

export function LoginClinicalSvgBackground() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1440 900"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    >
      <defs>
        <radialGradient id="ayuvaHaloLeft" cx="22%" cy="46%" r="36%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#EEF1F5" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ayuvaHaloRight" cx="80%" cy="54%" r="38%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="70%" stopColor="#0066FF" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#EEF1F5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ecgStroke" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0066FF" stopOpacity="0.05" />
          <stop offset="28%" stopColor="#0066FF" stopOpacity="0.48" />
          <stop offset="50%" stopColor="#EF233C" stopOpacity="0.45" />
          <stop offset="72%" stopColor="#0066FF" stopOpacity="0.48" />
          <stop offset="100%" stopColor="#0066FF" stopOpacity="0.05" />
        </linearGradient>
        <pattern id="clinicalGrid" width="64" height="64" patternUnits="userSpaceOnUse">
          <path d="M 64 0 L 0 0 0 64" stroke="#0F172A" strokeOpacity="0.03" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width="1440" height="900" fill="#EEF1F5" />
      <rect width="1440" height="900" fill="url(#clinicalGrid)" />
      <rect width="1440" height="900" fill="url(#ayuvaHaloLeft)" />
      <rect width="1440" height="900" fill="url(#ayuvaHaloRight)" />

      {/* Concentric studio circles inspired by the overview anatomy pedestal */}
      <circle cx="240" cy="460" r="245" fill="#FFFFFF" fillOpacity="0.48" stroke="#FFFFFF" strokeWidth="2" />
      <circle cx="240" cy="460" r="175" fill="#FFFFFF" fillOpacity="0.58" stroke="#E5E9F0" strokeWidth="1.5" />
      <circle cx="240" cy="460" r="108" fill="#FFFFFF" fillOpacity="0.82" stroke="#E5E9F0" strokeWidth="1.5" />

      {/* Stylized left anatomical heart/respiratory geometric vector silhouette */}
      <path
        d="M240 538C188 502 162 468 162 426C162 394 185 372 212 372C227 372 236 380 240 389C244 380 253 372 268 372C295 372 318 394 318 426C318 468 292 502 240 538Z"
        fill="#EF233C"
        fillOpacity="0.09"
        stroke="#EF233C"
        strokeOpacity="0.34"
        strokeWidth="2"
      />
      <circle cx="290" cy="402" r="7" fill="#FFFFFF" stroke="#0066FF" strokeWidth="3" />

      {/* Right studio diagnostic rings & card silhouettes */}
      <circle cx="1195" cy="445" r="230" fill="#FFFFFF" fillOpacity="0.45" stroke="#FFFFFF" strokeWidth="2" />
      <circle cx="1195" cy="445" r="158" fill="#FFFFFF" fillOpacity="0.65" stroke="#E5E9F0" strokeWidth="1.5" />
      <rect x="1085" y="250" width="210" height="92" rx="22" fill="#FFFFFF" fillOpacity="0.72" stroke="#E5E9F0" strokeWidth="1.5" />
      <rect x="1108" y="274" width="38" height="38" rx="19" fill="#0066FF" fillOpacity="0.12" />
      <path d="M1120 293 H1134 M1127 286 V300" stroke="#0066FF" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="1160" y="280" width="96" height="10" rx="5" fill="#CBD5E1" fillOpacity="0.55" />
      <rect x="1160" y="300" width="62" height="8" rx="4" fill="#CBD5E1" fillOpacity="0.4" />

      <rect x="1115" y="548" width="200" height="86" rx="22" fill="#0066FF" fillOpacity="0.08" stroke="#0066FF" strokeOpacity="0.2" strokeWidth="1.5" />
      <path d="M1142 594 H1170 L1182 574 L1196 614 L1210 582 L1220 594 H1285" stroke="#0066FF" strokeOpacity="0.55" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Continuous background clinical ECG PQRST telemetry waveform */}
      <path
        d="M0 712 H305 L322 694 L336 712 H368 L382 728 L398 632 L416 746 L432 712 H540 L558 696 L574 712 H885 L904 694 L920 712 H952 L966 728 L982 630 L1000 748 L1016 712 H1125 L1144 696 L1160 712 H1440"
        stroke="url(#ecgStroke)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Subtle telemetry dots matching reference node pins */}
      <circle cx="398" cy="632" r="5" fill="#EF233C" fillOpacity="0.7" />
      <circle cx="982" cy="630" r="5" fill="#0066FF" fillOpacity="0.75" />
      <circle cx="1195" cy="445" r="9" fill="#FFFFFF" stroke="#0066FF" strokeWidth="3" />
    </svg>
  );
}

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
          ? "/doctor/overview"
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
    <div className="relative min-h-dvh bg-[#EEF1F5] text-[#111827]">
      <LoginClinicalSvgBackground />

      <header className="relative z-10 border-b border-[#E5E9F0] bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/">
            <BrandMark />
          </Link>
          <Link
            to="/register"
            className="inline-flex min-h-[40px] items-center rounded-full border border-[#E5E9F0] bg-white px-4 text-xs font-semibold text-[#111827] hover:border-[#0066FF]/40 hover:text-[#0066FF]"
          >
            Need an account? Register
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-md flex-col gap-6 px-4 py-12 sm:px-6">
        <Card className="rounded-3xl border-[#E5E9F0] bg-white/95 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.14)] backdrop-blur-xl">
          <CardHeader className="rounded-t-3xl border-[#EEF1F5] bg-white px-7 pt-7 pb-5">
            <div className="mb-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-[#EFF6FF] px-3 py-1 text-xs font-semibold text-[#0066FF]">
              <Lock className="size-3.5" aria-hidden="true" />
              <span>Authenticated Access</span>
            </div>
            <CardTitle className="text-2xl font-semibold tracking-tight text-[#111827]">Sign in to Ayuva</CardTitle>
            <CardDescription className="text-xs text-[#64748B]">
              Access your personal health vault, clinician share sessions, or epidemiological workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 px-7 py-6">
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
                  className="rounded-xl border-[#E5E9F0] bg-[#F8FAFC]"
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
                  className="rounded-xl border-[#E5E9F0] bg-[#F8FAFC]"
                />
              </div>
              <Button type="submit" disabled={loading} className="mt-1 w-full rounded-full">
                <span>{loading ? "Signing in..." : "Sign In"}</span>
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            </form>

            <div className="border-t border-[#EEF1F5] pt-4">
              <div className="mb-2.5 flex items-center justify-between text-xs">
                <span className="font-semibold text-[#111827]">Quick Demo Sign In</span>
                <span className="text-[11px] text-[#64748B]">Zero mock records</span>
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
                      className="flex min-h-[46px] items-center justify-between rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] px-3.5 py-2 text-left text-xs transition-all hover:border-[#0066FF]/45 hover:bg-[#EFF6FF] disabled:opacity-50"
                    >
                      <span className="flex items-center gap-2.5 font-semibold text-[#111827]">
                        <span className="flex size-7 items-center justify-center rounded-full bg-[#0066FF] text-white">
                          <Icon className="size-3.5" aria-hidden="true" />
                        </span>
                        <span>{acc.label}</span>
                      </span>
                      <span className="text-[11px] text-[#64748B]">{acc.note}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-[#EEF1F5] pt-3 text-center text-xs text-[#64748B]">
              New user?{" "}
              <Link to="/register" className="font-semibold text-[#0066FF] hover:underline">
                Create a fresh Patient, Doctor, or Admin account
              </Link>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
