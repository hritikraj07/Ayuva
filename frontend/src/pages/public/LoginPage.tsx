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
          <stop offset="0%" stopColor="#0066FF" stopOpacity="0.06" />
          <stop offset="28%" stopColor="#0066FF" stopOpacity="0.5" />
          <stop offset="50%" stopColor="#EF233C" stopOpacity="0.48" />
          <stop offset="72%" stopColor="#0066FF" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#0066FF" stopOpacity="0.06" />
        </linearGradient>
        <pattern id="clinicalGrid" width="64" height="64" patternUnits="userSpaceOnUse">
          <path d="M 64 0 L 0 0 0 64" stroke="#0F172A" strokeOpacity="0.03" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width="1440" height="900" fill="#EEF1F5" />
      <rect width="1440" height="900" fill="url(#clinicalGrid)" />
      <rect width="1440" height="900" fill="url(#ayuvaHaloLeft)" />
      <rect width="1440" height="900" fill="url(#ayuvaHaloRight)" />

      {/* Left concentric radar rings with expanding pulse wave */}
      <g>
        <circle cx="240" cy="460" r="245" fill="#FFFFFF" fillOpacity="0.45" stroke="#FFFFFF" strokeWidth="2">
          <animate attributeName="r" values="240;252;240" dur="5.2s" repeatCount="indefinite" />
        </circle>
        <circle cx="240" cy="460" r="175" fill="#FFFFFF" fillOpacity="0.58" stroke="#E5E9F0" strokeWidth="1.5">
          <animate attributeName="r" values="172;182;172" dur="5.2s" repeatCount="indefinite" />
        </circle>
        <circle cx="240" cy="460" r="110" fill="none" stroke="#0066FF" strokeOpacity="0.22" strokeWidth="1.5">
          <animate attributeName="r" values="110;248" dur="4.2s" repeatCount="indefinite" />
          <animate attributeName="stroke-opacity" values="0.32;0" dur="4.2s" repeatCount="indefinite" />
        </circle>
        <circle cx="240" cy="460" r="108" fill="#FFFFFF" fillOpacity="0.86" stroke="#E5E9F0" strokeWidth="1.5" />
      </g>

      {/* Beating anatomical heart silhouette + orbiting diagnostic pin */}
      <g transform="translate(240 455)">
        <g>
          <animateTransform
            attributeName="transform"
            type="scale"
            values="1;1.07;0.99;1.045;1;1"
            keyTimes="0;0.14;0.24;0.34;0.48;1"
            dur="1.6s"
            repeatCount="indefinite"
          />
          <path
            d="M0 83C-52 47 -78 13 -78 -29C-78 -61 -55 -83 -28 -83C-13 -83 -4 -75 0 -66C4 -75 13 -83 28 -83C55 -83 78 -61 78 -29C78 13 52 47 0 83Z"
            fill="#EF233C"
            fillOpacity="0.11"
            stroke="#EF233C"
            strokeOpacity="0.38"
            strokeWidth="2.2"
          />
        </g>
        <g>
          <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="22s" repeatCount="indefinite" />
          <circle cx="52" cy="-54" r="7" fill="#FFFFFF" stroke="#0066FF" strokeWidth="3" />
        </g>
      </g>

      {/* Right diagnostic studio rings + rotating dashed telemetry arc */}
      <g>
        <circle cx="1195" cy="445" r="230" fill="#FFFFFF" fillOpacity="0.45" stroke="#FFFFFF" strokeWidth="2">
          <animate attributeName="r" values="226;236;226" dur="5.8s" repeatCount="indefinite" />
        </circle>
        <circle cx="1195" cy="445" r="158" fill="#FFFFFF" fillOpacity="0.68" stroke="#E5E9F0" strokeWidth="1.5" />
        <g transform="translate(1195 445)">
          <circle r="194" fill="none" stroke="#0066FF" strokeOpacity="0.24" strokeWidth="1.6" strokeDasharray="16 14 4 14">
            <animateTransform attributeName="transform" type="rotate" from="0" to="-360" dur="34s" repeatCount="indefinite" />
          </circle>
        </g>
      </g>

      {/* Floating top medical status card */}
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0,0; 0,-11; 0,0"
          dur="4.8s"
          repeatCount="indefinite"
        />
        <rect x="1085" y="250" width="210" height="92" rx="22" fill="#FFFFFF" fillOpacity="0.78" stroke="#E5E9F0" strokeWidth="1.5" />
        <rect x="1108" y="274" width="38" height="38" rx="19" fill="#0066FF" fillOpacity="0.14">
          <animate attributeName="fill-opacity" values="0.12;0.24;0.12" dur="2.6s" repeatCount="indefinite" />
        </rect>
        <path d="M1120 293 H1134 M1127 286 V300" stroke="#0066FF" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="1160" y="280" width="96" height="10" rx="5" fill="#CBD5E1" fillOpacity="0.6" />
        <rect x="1160" y="300" width="62" height="8" rx="4" fill="#CBD5E1" fillOpacity="0.45" />
      </g>

      {/* Counter-floating bottom live ECG monitor widget */}
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0,0; 0,10; 0,0"
          dur="5.2s"
          repeatCount="indefinite"
        />
        <rect x="1115" y="548" width="200" height="86" rx="22" fill="#0066FF" fillOpacity="0.08" stroke="#0066FF" strokeOpacity="0.22" strokeWidth="1.5" />
        <path
          id="miniEcgPath"
          d="M1142 594 H1170 L1182 574 L1196 614 L1210 582 L1220 594 H1285"
          stroke="#0066FF"
          strokeOpacity="0.58"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle r="4.5" fill="#0066FF">
          <animateMotion dur="2.8s" repeatCount="indefinite">
            <mpath href="#miniEcgPath" />
          </animateMotion>
        </circle>
      </g>

      {/* Continuous moving PQRST telemetry baseline across viewport */}
      <path
        id="mainEcgPath"
        d="M0 712 H305 L322 694 L336 712 H368 L382 728 L398 632 L416 746 L432 712 H540 L558 696 L574 712 H885 L904 694 L920 712 H952 L966 728 L982 630 L1000 748 L1016 712 H1125 L1144 696 L1160 712 H1440"
        stroke="url(#ecgStroke)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M0 712 H305 L322 694 L336 712 H368 L382 728 L398 632 L416 746 L432 712 H540 L558 696 L574 712 H885 L904 694 L920 712 H952 L966 728 L982 630 L1000 748 L1016 712 H1125 L1144 696 L1160 712 H1440"
        stroke="#0066FF"
        strokeOpacity="0.55"
        strokeWidth="2.6"
        strokeDasharray="110 1500"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <animate attributeName="stroke-dashoffset" from="1610" to="0" dur="4.6s" repeatCount="indefinite" />
      </path>

      {/* Gliding pulse beacon traveling along the main ECG waveform */}
      <circle r="5.5" fill="#EF233C" fillOpacity="0.88">
        <animateMotion dur="5.8s" repeatCount="indefinite">
          <mpath href="#mainEcgPath" />
        </animateMotion>
      </circle>
      <circle r="5.5" fill="#0066FF" fillOpacity="0.88">
        <animateMotion dur="5.8s" begin="-2.9s" repeatCount="indefinite">
          <mpath href="#mainEcgPath" />
        </animateMotion>
      </circle>

      {/* Pulsing right diagnostic hub indicator */}
      <circle cx="1195" cy="445" r="9" fill="#FFFFFF" stroke="#0066FF" strokeWidth="3">
        <animate attributeName="r" values="8;11;8" dur="2.6s" repeatCount="indefinite" />
      </circle>
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
    <div className="relative flex min-h-dvh flex-col bg-[#EEF1F5] text-[#111827] md:h-dvh md:overflow-hidden">
      <LoginClinicalSvgBackground />

      <header className="relative z-10 shrink-0 border-b border-[#E5E9F0] bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/">
            <BrandMark />
          </Link>
          <Link
            to="/register"
            className="inline-flex min-h-[36px] items-center rounded-full border border-[#E5E9F0] bg-white px-4 text-xs font-semibold text-[#111827] hover:border-[#0066FF]/40 hover:text-[#0066FF]"
          >
            Need an account? Register
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 items-center justify-center px-4 py-3 sm:px-6">
        <Card className="w-full rounded-3xl border-[#E5E9F0] bg-white/95 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.14)] backdrop-blur-xl">
          <CardHeader className="rounded-t-3xl border-[#EEF1F5] bg-white px-6 pt-5 pb-3.5">
            <div className="mb-1.5 inline-flex w-fit items-center gap-1.5 rounded-full bg-[#EFF6FF] px-3 py-0.5 text-[11px] font-semibold text-[#0066FF]">
              <Lock className="size-3" aria-hidden="true" />
              <span>Authenticated Access</span>
            </div>
            <CardTitle className="text-xl font-semibold tracking-tight text-[#111827]">Sign in to Ayuva</CardTitle>
            <CardDescription className="text-xs text-[#64748B]">
              Access your personal health vault, clinician share sessions, or epidemiological workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3.5 px-6 py-4">
            <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
              {error && (
                <Alert variant="danger" title="Authentication Failed">
                  {error}
                </Alert>
              )}
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="login-email">Email Address</FieldLabel>
                <Input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@organization.org"
                  className="h-9 rounded-xl border-[#E5E9F0] bg-[#F8FAFC]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="login-password">Password</FieldLabel>
                <Input
                  id="login-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="h-9 rounded-xl border-[#E5E9F0] bg-[#F8FAFC]"
                />
              </div>
              <Button type="submit" disabled={loading} className="mt-1 h-10 w-full rounded-full">
                <span>{loading ? "Signing in..." : "Sign In"}</span>
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            </form>

            <div className="border-t border-[#EEF1F5] pt-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-semibold text-[#111827]">Quick Demo Sign In</span>
                <span className="text-[11px] text-[#64748B]">Zero mock records</span>
              </div>
              <div className="grid gap-1.5">
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
                      className="flex min-h-[38px] items-center justify-between rounded-xl border border-[#E5E9F0] bg-[#F8FAFC] px-3 py-1.5 text-left text-xs transition-all hover:border-[#0066FF]/45 hover:bg-[#EFF6FF] disabled:opacity-50"
                    >
                      <span className="flex items-center gap-2 font-semibold text-[#111827]">
                        <span className="flex size-6 items-center justify-center rounded-full bg-[#0066FF] text-white">
                          <Icon className="size-3" aria-hidden="true" />
                        </span>
                        <span>{acc.label}</span>
                      </span>
                      <span className="text-[11px] text-[#64748B]">{acc.note}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-[#EEF1F5] pt-2.5 text-center text-xs text-[#64748B]">
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
