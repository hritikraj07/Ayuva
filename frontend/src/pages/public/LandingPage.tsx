import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import {
  Activity,
  ArrowRight,
  Bot,
  CalendarClock,
  ClipboardList,
  Database,
  FileSearch,
  FolderLock,
  Globe2,
  KeyRound,
  Lock,
  Pill,
  QrCode,
  ShieldCheck,
  Sliders,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BrandMark } from "@/components/BrandMark";
import { Badge } from "@/components/ui/primitives";
import { useSceneCapabilities } from "@/components/three/useSceneCapabilities";
import { useAuth } from "@/context/AuthContext";

gsap.registerPlugin(ScrollTrigger);

const HeroMedicalHeartAndDna3D = React.lazy(() =>
  import("@/components/three/MedicalModels3D").then((m) => ({ default: m.HeroMedicalHeartAndDna3D }))
);
const MedicalVaultRecords3D = React.lazy(() =>
  import("@/components/three/MedicalModels3D").then((m) => ({ default: m.MedicalVaultRecords3D }))
);
const MedicalPharmacology3D = React.lazy(() =>
  import("@/components/three/MedicalModels3D").then((m) => ({ default: m.MedicalPharmacology3D }))
);
const MedicalSecurityShield3D = React.lazy(() =>
  import("@/components/three/MedicalModels3D").then((m) => ({ default: m.MedicalSecurityShield3D }))
);
const OutbreakGlobe3D = React.lazy(() =>
  import("@/components/three/OutbreakGlobe3D").then((m) => ({ default: m.OutbreakGlobe3D }))
);

function ModelPlaceholder({ label, heightClass }: { label: string; heightClass: string }) {
  return (
    <div className={`neo-glass flex items-center justify-center rounded-2xl text-xs text-muted-foreground ${heightClass}`}>
      {label}
    </div>
  );
}

function computeLiveSeirComparison(
  initialCases: number,
  availableBeds: number,
  medicalStaff: number,
  preventionPct: number,
  vaccinationPct: number,
  startDay: number
) {
  const pop = 100000;
  const betaBase = 0.28;
  const sigma = 0.25;
  const gamma = 1 / 7.0;
  const hospRate = 0.1;
  const staffEff = 1.0 + Math.min(0.3, (medicalStaff / Math.max(availableBeds, 10)) * 0.22);

  let sB = pop - initialCases * 1.65;
  let eB = initialCases * 0.65;
  let iB = initialCases;

  let sI = sB;
  let eI = eB;
  let iI = iB;
  let vaxApplied = false;

  const series = [];
  for (let day = 1; day <= 30; day++) {
    const newExpB = (betaBase * sB * iB) / pop;
    const newInfB = sigma * eB;
    const newRecB = gamma * iB;
    sB = Math.max(0, sB - newExpB);
    eB = Math.max(0, eB + newExpB - newInfB);
    iB = Math.max(0, iB + newInfB - newRecB);

    let betaI = betaBase;
    if (day >= startDay) {
      betaI = betaBase * Math.max(0.28, 1.0 - (preventionPct / 100) * 0.48);
      if (!vaxApplied && vaccinationPct > 0) {
        const imm = sI * (vaccinationPct / 100) * 0.4;
        sI = Math.max(0, sI - imm);
        vaxApplied = true;
      }
    }
    const newExpI = (betaI * sI * iI) / pop;
    const newInfI = sigma * eI;
    const newRecI = gamma * iI;
    sI = Math.max(0, sI - newExpI);
    eI = Math.max(0, eI + newExpI - newInfI);
    iI = Math.max(0, iI + newInfI - newRecI);

    const hospDemandI = day >= startDay ? (iI * hospRate) / staffEff : iI * hospRate;

    series.push({
      day: `D${day}`,
      baselineCases: Math.round(newInfB * 10) / 10,
      interventionCases: Math.round(newInfI * 10) / 10,
      hospDemandI: Math.round(hospDemandI * 10) / 10,
      availableBeds,
    });
  }
  return series;
}

export function LandingPage() {
  const { user } = useAuth();
  const caps = useSceneCapabilities();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Interactive mathematical SEIR live calculator controls
  const [simCases, setSimCases] = useState(45);
  const [simBeds, setSimBeds] = useState(40);
  const [simStaff, setSimStaff] = useState(25);
  const [simPrevention, setSimPrevention] = useState(40);
  const [simVax, setSimVax] = useState(25);
  const [simStartDay, setSimStartDay] = useState(4);

  const simSeries = useMemo(
    () => computeLiveSeirComparison(simCases, simBeds, simStaff, simPrevention, simVax, simStartDay),
    [simCases, simBeds, simStaff, simPrevention, simVax, simStartDay]
  );

  const dashboardHref = user
    ? user.role === "admin"
      ? "/admin/overview"
      : user.role === "doctor"
      ? "/doctor/records"
      : "/patient/overview"
    : "/login";

  useEffect(() => {
    if (caps.reducedMotion) return;

    const lenis = new Lenis({
      duration: 1.05,
      smoothWheel: true,
      touchMultiplier: 1.2,
    });

    lenis.on("scroll", () => {
      ScrollTrigger.update();
    });

    let rafId = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>(".reveal-panel").forEach((el) => {
        gsap.fromTo(
          el,
          { y: 28, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.75,
            ease: "power3.out",
            scrollTrigger: {
              trigger: el,
              start: "top 86%",
              once: true,
            },
          }
        );
      });

      gsap.utils.toArray<HTMLElement>(".parallax-float").forEach((el, idx) => {
        gsap.to(el, {
          y: idx % 2 === 0 ? -16 : -10,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top bottom",
            end: "bottom top",
            scrub: true,
          },
        });
      });
    }, rootRef);

    return () => {
      cancelAnimationFrame(rafId);
      ctx.revert();
      lenis.destroy();
    };
  }, [caps.reducedMotion]);

  return (
    <div ref={rootRef} className="relative min-h-dvh bg-background text-foreground">
      {/* Subtle Clean Spatial Grid */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 neo-grid-overlay opacity-55" />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-300/80 bg-secondary/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" aria-label="MedLedger home">
            <BrandMark />
          </Link>
          <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-6 text-sm font-medium">
            <a href="#vault-experience" className="text-muted-foreground transition-colors hover:text-primary">
              Medical Vault
            </a>
            <a href="#ai-assistant" className="text-muted-foreground transition-colors hover:text-primary">
              Gemini AI
            </a>
            <a href="#outbreak-globe" className="text-muted-foreground transition-colors hover:text-primary">
              Outbreak Globe
            </a>
            <a href="#simulation" className="text-muted-foreground transition-colors hover:text-primary">
              SEIR Simulator
            </a>
            <a href="#security" className="text-muted-foreground transition-colors hover:text-primary">
              Security
            </a>
          </nav>
          <div className="flex items-center gap-2.5">
            {user ? (
              <Link
                to={dashboardHref}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                <span>Open Workspace</span>
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-primary hover:bg-card"
                >
                  Sign In / Demo
                </Link>
                <Link
                  to="/register"
                  className="inline-flex min-h-[44px] items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
                >
                  Explore the Platform
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* SECTION 1: HERO WITH DEDICATED 3D ANATOMICAL HEART & DNA MODEL */}
        <section className="border-b border-slate-300/70">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-12 lg:items-center lg:px-8 lg:py-20">
            <div className="flex flex-col gap-5 lg:col-span-6">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#66A9EC] bg-card px-3.5 py-1.5 text-xs font-semibold text-primary">
                <Sparkles className="size-3.5 text-[#0284C7]" aria-hidden="true" />
                <span>Personal Medical Intelligence &amp; Outbreak Surveillance</span>
              </div>

              <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl lg:leading-[1.08]">
                <span className="block text-primary">Smarter Health.</span>
                <span className="neo-text-gradient block">A Safer Tomorrow.</span>
              </h1>

              <p className="max-w-xl text-base leading-relaxed text-slate-700 sm:text-lg">
                An intelligent healthcare ecosystem connecting personal medical intelligence with predictive public
                health.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  to={dashboardHref}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm transition-transform hover:scale-[1.01] hover:bg-primary/90"
                >
                  <span>Explore the Platform</span>
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <a
                  href="#vault-experience"
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-lg border border-slate-300 bg-white/95 px-6 text-sm font-semibold text-primary hover:bg-card"
                >
                  <span>Discover Our Technology</span>
                </a>
              </div>

              <div className="grid gap-3 pt-3 sm:grid-cols-3">
                <div className="neo-glass parallax-float rounded-xl p-3.5">
                  <div className="font-mono text-[11px] font-semibold text-[#0284C7]">MODULE 01 // VAULT</div>
                  <div className="mt-1 text-xs font-semibold text-primary">pypdf + RapidOCR Pipeline</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">Human-verified extraction</div>
                </div>
                <div className="neo-glass parallax-float rounded-xl p-3.5">
                  <div className="font-mono text-[11px] font-semibold text-[#0284C7]">MODULE 02 // CLINICAL AI</div>
                  <div className="mt-1 text-xs font-semibold text-primary">Gemini + OpenFDA Labels</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">Scoped consent retrieval</div>
                </div>
                <div className="neo-glass parallax-float rounded-xl p-3.5">
                  <div className="font-mono text-[11px] font-semibold text-[#0284C7]">MODULE 03 // SURVEILLANCE</div>
                  <div className="mt-1 text-xs font-semibold text-primary">NCDC/IDSP + Open-Meteo</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">RandomForest &amp; SEIR engine</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:col-span-6">
              <Suspense fallback={<ModelPlaceholder label="Loading 3D Cardiac & Genomic Anatomy..." heightClass="h-[420px]" />}>
                <HeroMedicalHeartAndDna3D heightClass="h-[420px]" />
              </Suspense>
              <div className="neo-glass flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-xs">
                <span className="flex items-center gap-2 font-medium text-primary">
                  <Activity className="size-4 text-[#0284C7]" aria-hidden="true" />
                  New accounts start empty until you upload real records or sync IDSP data.
                </span>
                <Badge variant="teal">Zero Mock Records</Badge>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: THE PERSONAL HEALTH INTELLIGENCE EXPERIENCE */}
        <section id="vault-experience" className="border-b border-slate-300/70 py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
              <div className="reveal-panel lg:col-span-5">
                <Suspense fallback={<ModelPlaceholder label="Loading 3D Medical Vault Model..." heightClass="h-[360px]" />}>
                  <MedicalVaultRecords3D heightClass="h-[360px]" />
                </Suspense>
              </div>
              <div className="reveal-panel flex flex-col gap-4 lg:col-span-7">
                <div className="font-mono text-xs font-semibold uppercase tracking-widest text-[#0284C7]">
                  02 // Personal Health Intelligence
                </div>
                <h2 className="font-display text-3xl font-bold tracking-tight text-primary sm:text-4xl">
                  A structured digital medical vault built for clarity before every consultation.
                </h2>
                <p className="text-base leading-relaxed text-slate-700">
                  Upload PDFs, mobile photos of physical prescriptions, or lab reports. Local OCR extracts visible
                  fields for your review before structuring them into your chronological medical history.
                </p>
                <div className="flex flex-wrap gap-3 pt-1">
                  <Link
                    to="/patient/vault"
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary px-5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    <span>Open Medical Vault</span>
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                  <Link
                    to="/login"
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-xs font-semibold text-primary hover:bg-card"
                  >
                    <span>Try Demo Patient</span>
                  </Link>
                </div>
              </div>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: FolderLock,
                  tag: "INGESTION",
                  title: "Verified Document Vault",
                  desc: "Supports PDF, JPG, JPEG, and PNG with magic-byte checks, upload progress, preview, download, and deletion.",
                },
                {
                  icon: FileSearch,
                  tag: "LOCAL OCR + REVIEW",
                  title: "Human-Confirmed Extraction",
                  desc: "Identifies doctor, dates, medicines, lab ranges, and allergies without ever fabricating missing fields.",
                },
                {
                  icon: CalendarClock,
                  tag: "CHRONOLOGY",
                  title: "Medical History Timeline",
                  desc: "Organizes verified events and longitudinal lab biomarker trends with filters by category, doctor, and condition.",
                },
                {
                  icon: ClipboardList,
                  tag: "ONE-MINUTE BRIEF",
                  title: "Doctor Summary PDF",
                  desc: "Generates a consultation summary separating verified vault facts from automated highlights, exportable as PDF.",
                },
                {
                  icon: QrCode,
                  tag: "SCOPED ACCESS",
                  title: "QR & PIN Record Sharing",
                  desc: "Share selected documents via expiring tokens and PIN verification with instant revocation and audit logs.",
                },
              ].map((item, idx) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className={`reveal-panel neo-glass rounded-2xl p-6 transition-all hover:border-[#66A9EC] ${
                      idx === 4 ? "md:col-span-2 lg:col-span-1" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] font-semibold text-[#0284C7]">{item.tag}</span>
                      <div className="flex size-10 items-center justify-center rounded-lg border border-[#66A9EC]/60 bg-card text-primary">
                        <Icon className="size-5" aria-hidden="true" />
                      </div>
                    </div>
                    <h3 className="mt-4 font-display text-lg font-semibold text-primary">{item.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
                  </div>
                );
              })}

              <div className="reveal-panel neo-glass-violet flex flex-col justify-between rounded-2xl p-6">
                <div>
                  <span className="font-mono text-[11px] font-semibold text-[#0284C7]">CLEAN ONBOARDING</span>
                  <h3 className="mt-3 font-display text-lg font-semibold text-primary">Start Your Health Vault</h3>
                  <p className="mt-2 text-sm text-slate-700">
                    Register a new account or sign in as Demo Patient to upload and verify your first document.
                  </p>
                </div>
                <Link
                  to="/patient/vault"
                  className="mt-5 inline-flex min-h-[44px] w-fit items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <span>Launch Medical Vault</span>
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: PERSONALIZED AI HEALTH ASSISTANT + PHARMACOLOGY 3D MODEL */}
        <section id="ai-assistant" className="border-b border-slate-300/70 py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
              <div className="reveal-panel flex flex-col gap-5 lg:col-span-6">
                <div className="font-mono text-xs font-semibold uppercase tracking-widest text-[#0284C7]">
                  03 // Personalized AI &amp; Pharmacology
                </div>
                <h2 className="font-display text-3xl font-bold tracking-tight text-primary sm:text-4xl">
                  Gemini-powered clarity grounded strictly in your consented records.
                </h2>
                <p className="text-base leading-relaxed text-slate-700">
                  Toggle personal vault context on or off per conversation. Relevant lab results, documented allergies,
                  and prescription images stay isolated to your session, paired with live OpenFDA drug labeling and
                  server-enforced emergency triage rules.
                </p>
                <Link
                  to="/patient/assistant"
                  className="inline-flex min-h-[48px] w-fit items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <Bot className="size-4" aria-hidden="true" />
                  <span>Open AI Health Assistant</span>
                </Link>
              </div>

              <div className="reveal-panel lg:col-span-6">
                <Suspense fallback={<ModelPlaceholder label="Loading 3D Pharmacology & Molecule Model..." heightClass="h-[340px]" />}>
                  <MedicalPharmacology3D heightClass="h-[340px]" />
                </Suspense>
              </div>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: Pill,
                  title: "Medicine Identification",
                  desc: "Analyze uploaded pill/prescription images via Gemini multimodal vision + RapidOCR alongside live OpenFDA prescribing label lookups.",
                },
                {
                  icon: FileSearch,
                  title: "Medical Report Explanation",
                  desc: "Attach vault reports or PDFs directly in chat to translate clinical terminology and out-of-range markers into plain language.",
                },
                {
                  icon: ShieldCheck,
                  title: "Personalized Precautions",
                  desc: "Retrieves only documented allergies and relevant medications when consent is enabled, never inventing missing facts.",
                },
                {
                  icon: Stethoscope,
                  title: "Consultation Preparation",
                  desc: "Maintains persisted multi-turn conversations and suggests structured questions to ask your licensed physician.",
                },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <div key={card.title} className="reveal-panel neo-glass rounded-2xl p-5">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-[#66A9EC]/60 bg-card text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </div>
                    <h3 className="mt-3.5 font-display text-base font-semibold text-primary">{card.title}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-700">{card.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* SECTION 4: DISEASE OUTBREAK INTELLIGENCE + 3D GLOBE */}
        <section id="outbreak-globe" className="border-b border-slate-300/70 py-20">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:items-center lg:px-8">
            <div className="reveal-panel lg:col-span-7">
              <Suspense fallback={<ModelPlaceholder label="Initializing 3D Epidemiological Globe..." heightClass="h-[400px]" />}>
                <OutbreakGlobe3D regions={[]} selectedRegionId={null} heightClass="h-[400px]" />
              </Suspense>
            </div>

            <div className="reveal-panel flex flex-col gap-5 lg:col-span-5">
              <div className="font-mono text-xs font-semibold uppercase tracking-widest text-[#0284C7]">
                04 // Disease Outbreak Intelligence
              </div>
              <h2 className="font-display text-3xl font-bold tracking-tight text-primary sm:text-4xl">
                Interactive planetary surveillance backed by verified bulletins.
              </h2>
              <p className="text-base leading-relaxed text-slate-700">
                Synchronize official weekly epidemiological PDFs from India NCDC/IDSP paired with Open-Meteo geocoding
                and weather covariates. A chronological RandomForestClassifier evaluates multi-week surges and marks
                unreported districts honestly as Insufficient Data.
              </p>

              <div className="neo-glass rounded-xl p-4 text-xs text-slate-700">
                <div className="font-semibold text-primary">Zero-Fabrication Surveillance Guarantee</div>
                <p className="mt-1 leading-relaxed text-muted-foreground">
                  No synthetic outbreak markers are shown on this public overview. Sign in as Demo Admin or Public
                  Health Officer to trigger live NCDC/IDSP synchronization and populate verified district markers.
                </p>
              </div>

              <Link
                to="/admin/overview"
                className="inline-flex min-h-[48px] w-fit items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                <Globe2 className="size-4" aria-hidden="true" />
                <span>Explore Analytics</span>
              </Link>
            </div>
          </div>
        </section>

        {/* SECTION 5: INTERVENTION SIMULATION */}
        <section id="simulation" className="border-b border-slate-300/70 py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="reveal-panel max-w-3xl">
              <div className="font-mono text-xs font-semibold uppercase tracking-widest text-[#0284C7]">
                05 // SEIR Scientific Simulation
              </div>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-primary sm:text-4xl">
                Model hospital capacity and surge interventions deterministically.
              </h2>
              <p className="mt-3 text-base leading-relaxed text-slate-700">
                Every curve below is solved live in-browser from the deterministic SEIR equations (
                <code className="font-mono text-xs text-[#0284C7]">dS/dt, dE/dt, dI/dt, dR/dt</code>) using your slider
                inputs. Inside the Admin Simulator, scenarios run directly against geocoded district populations.
              </p>
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-12">
              <div className="reveal-panel neo-glass flex flex-col gap-4 rounded-2xl p-6 text-xs lg:col-span-5">
                <div className="flex items-center justify-between border-b border-slate-300 pb-3">
                  <span className="font-display text-sm font-semibold text-primary">Live SEIR Parameters</span>
                  <Badge variant="teal">Deterministic ODE</Badge>
                </div>

                {[
                  { id: "land-cases", label: "Initial Active Cases", value: simCases, set: setSimCases, min: 5, max: 300, unit: "" },
                  { id: "land-beds", label: "Available Hospital Beds", value: simBeds, set: setSimBeds, min: 5, max: 200, unit: "" },
                  { id: "land-staff", label: "Medical Staff", value: simStaff, set: setSimStaff, min: 5, max: 150, unit: "" },
                  { id: "land-prev", label: "Prevention Coverage", value: simPrevention, set: setSimPrevention, min: 0, max: 90, unit: "%" },
                  { id: "land-vax", label: "Vaccination Rollout", value: simVax, set: setSimVax, min: 0, max: 90, unit: "%" },
                  { id: "land-day", label: "Intervention Start Day", value: simStartDay, set: setSimStartDay, min: 1, max: 20, unit: "" },
                ].map((ctrl) => (
                  <div key={ctrl.id} className="flex flex-col gap-1">
                    <div className="flex justify-between">
                      <label htmlFor={ctrl.id} className="font-medium text-primary">
                        {ctrl.label}
                      </label>
                      <span className="font-mono font-semibold text-[#0284C7]">
                        {ctrl.value}
                        {ctrl.unit}
                      </span>
                    </div>
                    <input
                      id={ctrl.id}
                      type="range"
                      min={ctrl.min}
                      max={ctrl.max}
                      value={ctrl.value}
                      onChange={(e) => ctrl.set(Number(e.target.value))}
                      className="accent-[#323A4D]"
                    />
                  </div>
                ))}

                <Link
                  to="/admin/simulator"
                  className="mt-2 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <Sliders className="size-4" aria-hidden="true" />
                  <span>Open Full District SEIR Workspace</span>
                </Link>
              </div>

              <div className="reveal-panel neo-glass rounded-2xl p-6 lg:col-span-7">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-semibold text-primary">
                      30-Day Baseline vs. Intervention Incidence
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Updates live as you adjust caseload, bed capacity, staffing, and coverage parameters
                    </p>
                  </div>
                  <Badge variant="neutral">N = 100,000 Reference Cohort</Badge>
                </div>
                <div className="h-[320px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={simSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#CBD5E1" />
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#323A4D" }} />
                      <YAxis tick={{ fontSize: 11, fill: "#323A4D" }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#F9FAFB",
                          borderColor: "#66A9EC",
                          borderRadius: "8px",
                          fontSize: "12px",
                          color: "#141C2E",
                        }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="baselineCases"
                        name="Baseline (No Action)"
                        stroke="#E11D48"
                        strokeWidth={2.5}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="interventionCases"
                        name="With Intervention"
                        stroke="#0284C7"
                        strokeWidth={2.5}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 6: SECURITY AND TRUST + 3D MEDICAL SHIELD */}
        <section id="security" className="py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
              <div className="reveal-panel flex flex-col gap-4 lg:col-span-7">
                <div className="font-mono text-xs font-semibold uppercase tracking-widest text-[#0284C7]">
                  06 // Cryptographic Security &amp; Access Governance
                </div>
                <h2 className="font-display text-3xl font-bold tracking-tight text-primary sm:text-4xl">
                  Strict role isolation and transparent access governance.
                </h2>
                <p className="text-base text-slate-700">
                  Every control listed below maps directly to enforced FastAPI route dependencies and database audit
                  tables inside MedLedger.
                </p>
              </div>
              <div className="reveal-panel lg:col-span-5">
                <Suspense fallback={<ModelPlaceholder label="Loading 3D Privacy & Access Shield..." heightClass="h-[320px]" />}>
                  <MedicalSecurityShield3D heightClass="h-[320px]" />
                </Suspense>
              </div>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: KeyRound,
                  title: "Bcrypt & JWT Authentication",
                  desc: "Passwords are hashed with 12-round bcrypt salts; endpoints validate signed JWT bearer tokens on every request.",
                },
                {
                  icon: Lock,
                  title: "Role-Based API Isolation",
                  desc: "Public Health Admins cannot read private patient vaults; patients cannot modify surveillance pipelines.",
                },
                {
                  icon: QrCode,
                  title: "Temporary QR & PIN Sharing",
                  desc: "Share sessions expire automatically, hash PINs on the server, restrict doctors strictly to selected document IDs, and support instant revocation.",
                },
                {
                  icon: Database,
                  title: "User-Scoped Queries",
                  desc: "Vault documents, timelines, summaries, and Gemini chat threads filter strictly by the authenticated patient_id.",
                },
                {
                  icon: ShieldCheck,
                  title: "Access Audit History",
                  desc: "Creates server-side AccessLog entries on share creation, PIN failure, document views, revocation, and assistant access.",
                },
                {
                  icon: FolderLock,
                  title: "Consent & Erasure Controls",
                  desc: "Toggle AI context processing anytime or permanently delete all uploaded medical files and structured vault records from Profile & Privacy.",
                },
              ].map((sec) => {
                const Icon = sec.icon;
                return (
                  <div key={sec.title} className="reveal-panel neo-glass rounded-2xl p-6">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-[#66A9EC]/60 bg-card text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </div>
                    <h3 className="mt-4 font-display text-base font-semibold text-primary">{sec.title}</h3>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{sec.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-slate-300/80 bg-secondary/90 py-8 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <BrandMark />
            <span>Educational healthcare &amp; public-health surveillance platform. Not a diagnostic medical device.</span>
          </div>
          <div className="flex flex-wrap gap-4">
            <a href="#vault-experience" className="hover:text-primary">
              Vault
            </a>
            <a href="#ai-assistant" className="hover:text-primary">
              Assistant
            </a>
            <a href="#outbreak-globe" className="hover:text-primary">
              Outbreak Globe
            </a>
            <Link to="/login" className="hover:text-primary">
              Sign In
            </Link>
            <Link to="/register" className="hover:text-primary">
              Register
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
