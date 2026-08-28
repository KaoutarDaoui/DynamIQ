import type { ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import AppLayout from "./layouts/AppLayout";
import Login from "./pages/Login";
import Portfolio from "./pages/Portfolio";
import OnboardingWizard from "./pages/onboarding/OnboardingWizard";
import Dashboard from "./pages/Dashboard";
import FloorView from "./pages/FloorView";
import RoomDetail from "./pages/RoomDetail";
import AcRegistry from "./pages/AcRegistry";
import Anomalies from "./pages/Anomalies";
import DiagnosisDetail from "./pages/DiagnosisDetail";
import Alerts from "./pages/Alerts";
import Reports from "./pages/Reports";
import AuditLogPage from "./pages/AuditLog";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import Help from "./pages/Help";
import Thermal from "./pages/Thermal";
import Mpc from "./pages/Mpc";
import Diagnoses from "./pages/Diagnoses";
import ComingSoon from "./pages/ComingSoon";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/onboarding" element={<OnboardingWizard />} />

          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Portfolio />} />
            <Route path="/dashboard" element={<ComingSoon />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/help" element={<Help />} />

            <Route path="/b/:buildingId">
              <Route index element={<Dashboard />} />
              <Route path="floors/:floorId?" element={<FloorView />} />
              <Route path="rooms/:roomId" element={<RoomDetail />} />
              <Route path="registry" element={<AcRegistry />} />
              <Route path="anomalies" element={<Anomalies />} />
              <Route
                path="anomalies/:anomalyId"
                element={<DiagnosisDetail />}
              />
              <Route path="alerts" element={<Alerts />} />
              <Route path="reports" element={<Reports />} />
              <Route path="audit" element={<AuditLogPage />} />
              <Route path="settings" element={<Settings />} />
              <Route path="thermal" element={<Thermal />} />
              <Route path="mpc" element={<Mpc />} />
              <Route path="diagnoses" element={<Diagnoses />} />
              <Route path="admin" element={<ComingSoon />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
