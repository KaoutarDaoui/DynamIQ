import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import Help from "./pages/Help";
import Thermal from "./pages/Thermal";
import Mpc from "./pages/Mpc";
import Diagnoses from "./pages/Diagnoses";
import ComingSoon from "./pages/ComingSoon";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<OnboardingWizard />} />

        <Route element={<AppLayout />}>
          <Route path="/" element={<Portfolio />} />
          <Route path="/help" element={<Help />} />

          <Route path="/b/:buildingId">
            <Route index element={<Dashboard />} />
            <Route path="floors/:floorId" element={<FloorView />} />
            <Route path="rooms/:roomId" element={<RoomDetail />} />
            <Route path="registry" element={<AcRegistry />} />
            <Route path="anomalies" element={<Anomalies />} />
            <Route path="anomalies/:anomalyId" element={<DiagnosisDetail />} />
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
    </BrowserRouter>
  );
}