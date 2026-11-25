import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Bell,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  FolderLock,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  MessageSquareHeart,
  Share2,
  Sliders,
  Stethoscope,
  TrendingUp,
  UserCog,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { Badge, Button } from "@/components/ui/primitives";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

const ROLE_NAVS: Record<"patient" | "doctor" | "admin", NavGroup[]> = {
  patient: [
    {
      heading: "Personal Health",
      items: [
        { to: "/patient/overview", label: "Overview", icon: LayoutDashboard },
        { to: "/patient/vault", label: "My Medical Vault", icon: FolderLock },
        { to: "/patient/timeline", label: "Medical Timeline", icon: CalendarClock },
      ],
    },
    {
      heading: "Clinical Preparation",
      items: [
        { to: "/patient/assistant", label: "AI Health Assistant", icon: MessageSquareHeart },
        { to: "/patient/summary", label: "Doctor Summary", icon: ClipboardList },
        { to: "/patient/share", label: "Share Medical Records", icon: Share2 },
      ],
    },
    {
      heading: "Account",
      items: [{ to: "/patient/profile", label: "Profile & Privacy", icon: UserCog }],
    },
  ],
  doctor: [
    {
      heading: "Clinician Access",
      items: [
        { to: "/doctor/records", label: "Shared Patient Records", icon: Stethoscope },
        { to: "/doctor/viewer", label: "Document & Summary Viewer", icon: FileText },
      ],
    },
  ],
  admin: [
    {
      heading: "Surveillance & Prediction",
      items: [
        { to: "/admin/overview", label: "Outbreak Overview", icon: Activity },
        { to: "/admin/prediction", label: "Disease Prediction", icon: TrendingUp },
        { to: "/admin/map", label: "Geospatial Risk Map", icon: MapPin },
      ],
    },
    {
      heading: "Response & Planning",
      items: [
        { to: "/admin/analytics", label: "Disease Analytics", icon: LayoutDashboard },
        { to: "/admin/simulator", label: "Intervention Simulator", icon: Sliders },
        { to: "/admin/alerts", label: "Public Health Alerts", icon: Bell },
      ],
    },
  ],
};

const ROLE_LABELS: Record<string, string> = {
  patient: "Patient Vault",
  doctor: "Doctor Portal",
  admin: "Public Health Admin",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [mobileOpen]);

  if (!user) return null;

  const groups = ROLE_NAVS[user.role];

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const renderNavGroups = (isCompact: boolean) => (
    <nav aria-label="Workspace navigation" className="flex flex-1 flex-col gap-5 px-3 py-4 overflow-y-auto">
      {groups.map((grp) => (
        <div key={grp.heading} className="flex flex-col gap-1">
          {!isCompact && (
            <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {grp.heading}
            </div>
          )}
          {grp.items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                title={item.label}
                aria-label={item.label}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150",
                    isActive
                      ? "bg-primary font-semibold text-primary-foreground shadow-sm"
                      : "text-foreground/85 hover:bg-card hover:text-primary",
                    isCompact && "justify-center px-0"
                  )
                }
              >
                <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                {!isCompact && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col border-r border-slate-300/80 bg-secondary/90 backdrop-blur-xl transition-all duration-150 shrink-0",
          collapsed ? "w-[74px]" : "w-[268px]"
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
          {!collapsed ? (
            <Link to="/" aria-label="Ayuva Home">
              <BrandMark />
            </Link>
          ) : (
            <Link to="/" aria-label="Ayuva Home" className="mx-auto">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">
                AY
              </span>
            </Link>
          )}
          {!collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-expanded={true}
              aria-label="Collapse navigation sidebar"
              className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {collapsed && (
          <div className="flex justify-center border-b border-border py-2">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-expanded={false}
              aria-label="Expand navigation sidebar"
              className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {renderNavGroups(collapsed)}

        <div className="border-t border-border p-3">
          {!collapsed && (
            <div className="mb-3 flex flex-col gap-1 rounded-md bg-muted/60 px-3 py-2">
              <div className="truncate text-xs font-semibold text-foreground">{user.full_name}</div>
              <div className="truncate text-[11px] text-muted-foreground">{user.email}</div>
              <Badge variant="teal" className="mt-1 w-fit">
                {ROLE_LABELS[user.role]}
              </Badge>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            aria-label="Sign out"
            className={cn("w-full", collapsed && "px-0")}
          >
            <LogOut className="size-4 shrink-0" aria-hidden="true" />
            {!collapsed && <span>Sign Out</span>}
          </Button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden bg-[#0F172A]/60"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation menu"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMobileOpen(false);
          }}
        >
          <div className="flex h-full w-72 flex-col bg-card border-r border-border">
            <div className="flex h-16 items-center justify-between border-b border-border px-4">
              <BrandMark />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation menu"
                className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            {renderNavGroups(false)}
            <div className="border-t border-border p-4">
              <div className="mb-3 text-xs font-semibold text-foreground">{user.full_name}</div>
              <Button variant="outline" size="sm" onClick={handleLogout} className="w-full">
                <LogOut className="size-4" aria-hidden="true" />
                <span>Sign Out</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-300/80 bg-secondary/85 px-4 backdrop-blur-xl lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground lg:hidden"
            >
              <Menu className="size-4" aria-hidden="true" />
              <span>Menu</span>
            </button>
            <div className="flex items-center gap-2 lg:hidden">
              <BrandMark />
            </div>
            <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{ROLE_LABELS[user.role]}</span>
              <span>/</span>
              <span>{user.specialty_or_department || "Private Personal Workspace"}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="teal" className="hidden sm:inline-flex">
              {ROLE_LABELS[user.role]}
            </Badge>
            <Link
              to="/"
              className="inline-flex min-h-[44px] items-center rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"
            >
              Platform Home
            </Link>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
