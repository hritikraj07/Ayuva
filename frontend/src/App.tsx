import React, { Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LoadingState } from "@/components/ui/primitives";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AdminDirectoryPage } from "@/pages/admin/AdminDirectoryPage";
import { AdminOutbreakView } from "@/pages/admin/AdminOutbreakPages";
import { DoctorPortalPages } from "@/pages/doctor/DoctorPortalPages";
import { DoctorRecordsPage } from "@/pages/doctor/DoctorRecordsPage";
import { DoctorSummaryPage } from "@/pages/patient/DoctorSummaryPage";
import { FindDoctorPage } from "@/pages/patient/FindDoctorPage";
import { HealthAssistantPage } from "@/pages/patient/HealthAssistantPage";
import { MedicalTimelinePage } from "@/pages/patient/MedicalTimelinePage";
import { MedicalVaultPage } from "@/pages/patient/MedicalVaultPage";
import { MyAppointmentsPage } from "@/pages/patient/MyAppointmentsPage";
import { PatientOverviewPage } from "@/pages/patient/PatientOverviewPage";
import { PatientProfilePage } from "@/pages/patient/PatientProfilePage";
import { ShareRecordsPage } from "@/pages/patient/ShareRecordsPage";
import { LandingPage } from "@/pages/public/LandingPage";
import { LoginPage } from "@/pages/public/LoginPage";
import { PublicShareViewerPage } from "@/pages/public/PublicShareViewerPage";
import { RegisterPage } from "@/pages/public/RegisterPage";

function ProtectedRoute({
  allowedRoles,
  children,
}: {
  allowedRoles: Array<"patient" | "doctor" | "admin">;
  children: React.ReactNode;
}) {
  const { user, isReady } = useAuth();
  if (!isReady) {
    return (
      <div className="p-8">
        <LoadingState message="Verifying your session..." />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(user.role)) {
    const target = user.role === "admin" ? "/admin/overview" : user.role === "doctor" ? "/doctor/overview" : "/patient/overview";
    return <Navigate to={target} replace />;
  }
  return (
    <AppShell>
      <Suspense fallback={<LoadingState message="Loading module..." />}>{children}</Suspense>
    </AppShell>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/share/:token" element={<PublicShareViewerPage />} />

            {/* Patient Routes */}
            <Route
              path="/patient/overview"
              element={
                <ProtectedRoute allowedRoles={["patient"]}>
                  <PatientOverviewPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/patient/vault"
              element={
                <ProtectedRoute allowedRoles={["patient"]}>
                  <MedicalVaultPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/patient/timeline"
              element={
                <ProtectedRoute allowedRoles={["patient"]}>
                  <MedicalTimelinePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/patient/assistant"
              element={
                <ProtectedRoute allowedRoles={["patient"]}>
                  <HealthAssistantPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/patient/summary"
              element={
                <ProtectedRoute allowedRoles={["patient"]}>
                  <DoctorSummaryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/patient/share"
              element={
                <ProtectedRoute allowedRoles={["patient"]}>
                  <ShareRecordsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/patient/profile"
              element={
                <ProtectedRoute allowedRoles={["patient"]}>
                  <PatientProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/patient/doctors"
              element={
                <ProtectedRoute allowedRoles={["patient"]}>
                  <FindDoctorPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/patient/appointments"
              element={
                <ProtectedRoute allowedRoles={["patient"]}>
                  <MyAppointmentsPage />
                </ProtectedRoute>
              }
            />

            {/* Doctor Routes */}
            <Route
              path="/doctor/overview"
              element={
                <ProtectedRoute allowedRoles={["doctor"]}>
                  <DoctorPortalPages section="overview" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/doctor/appointments"
              element={
                <ProtectedRoute allowedRoles={["doctor"]}>
                  <DoctorPortalPages section="appointments" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/doctor/availability"
              element={
                <ProtectedRoute allowedRoles={["doctor"]}>
                  <DoctorPortalPages section="availability" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/doctor/profile"
              element={
                <ProtectedRoute allowedRoles={["doctor"]}>
                  <DoctorPortalPages section="profile" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/doctor/clinic"
              element={
                <ProtectedRoute allowedRoles={["doctor"]}>
                  <DoctorPortalPages section="clinic" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/doctor/records"
              element={
                <ProtectedRoute allowedRoles={["doctor"]}>
                  <DoctorRecordsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/doctor/viewer"
              element={
                <ProtectedRoute allowedRoles={["doctor"]}>
                  <DoctorRecordsPage />
                </ProtectedRoute>
              }
            />

            {/* Public Health Admin Routes */}
            <Route
              path="/admin/doctors"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AdminDirectoryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/overview"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AdminOutbreakView section="overview" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/prediction"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AdminOutbreakView section="prediction" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/map"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AdminOutbreakView section="map" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/analytics"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AdminOutbreakView section="analytics" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/simulator"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AdminOutbreakView section="simulator" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/alerts"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AdminOutbreakView section="alerts" />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
