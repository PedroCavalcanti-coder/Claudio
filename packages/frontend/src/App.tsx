import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './stores/authStore';
import { authApi } from './api/endpoints';
import AppLayout         from './components/layout/AppLayout';
import RoleGuard         from './components/auth/RoleGuard';

import LoginPaciente  from './pages/auth/LoginPaciente';
import ChangePasswordPage from './pages/auth/ChangePasswordPage';
import LoginMedico    from './pages/auth/LoginMedico';
import LoginRecepcao  from './pages/auth/LoginRecepcao';
import LoginTecnico   from './pages/auth/LoginTecnico';
import LoginEnfermeiro from './pages/auth/LoginEnfermeiro';
import LoginAdmin     from './pages/auth/LoginAdmin';
import ResetPassword  from './pages/auth/ResetPassword';

import PortalDoPaciente from './pages/portal/PortalDoPaciente';

import DashboardPage    from './pages/dashboard/DashboardPage';
import PatientsPage     from './pages/patients/PatientsPage';
import PatientChartPage from './pages/patients/PatientChartPage';
import AtendimentoPage  from './pages/atendimento/AtendimentoPage';
import AtendimentoConsultaPage from './pages/atendimento/AtendimentoConsultaPage';
import MedicacaoPage    from './pages/atendimento/MedicacaoPage';
import PainelPage       from './pages/painel/PainelPage';
import RelatoriosPage   from './pages/relatorios/RelatoriosPage';
import FarmaciaPage     from './pages/farmacia/FarmaciaPage';
import TeleconsultaPage from './pages/teleconsulta/TeleconsultaPage';
import TeleRoomPage     from './pages/teleconsulta/TeleRoomPage';
import TermosDeUso      from './pages/legal/TermosDeUso';
import AppointmentsPage from './pages/appointments/AppointmentsPage';
import WorklistPage     from './pages/worklist/WorklistPage';
import StudiesPage      from './pages/studies/StudiesPage';
import DicomUploadPage  from './pages/studies/DicomUploadPage';

import OrthoVisPage      from './orthovis/OrthoVisPage';
import WebviewerPage     from './pages/viewer/WebviewerPage';
import NotFoundPage      from './pages/NotFoundPage';
import ErrorBoundary     from './components/ErrorBoundary';
import { Toaster }       from './components/ui/Toast';
import CookieConsent     from './components/CookieConsent';
import ReportsPage      from './pages/reports/ReportsPage';
import SecondOpinionPage from './pages/second-opinion/SecondOpinionPage';
import ProceduresPage   from './pages/procedures/ProceduresPage';
import AdminHomePage    from './pages/admin/AdminHomePage';
import AdminUnitsPage   from './pages/admin/AdminUnitsPage';
import AdminStaffPage   from './pages/admin/AdminStaffPage';
import AdminAuditPage   from './pages/admin/AdminAuditPage';
import UnitManagePage   from './pages/admin/UnitManagePage';
import ReferralsInboxPage from './pages/referrals/ReferralsInboxPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const role            = useAuthStore(s => s.user?.role);
  // Sessões antigas (persistidas) não têm as permissões granulares, e o admin pode ter mudado
  // overrides: sincroniza telas e botões com o backend uma vez por carregamento.
  useEffect(() => {
    if (!isAuthenticated || !role || role === 'patient') return;
    authApi.me().then((r) => {
      const d = (r.data as any)?.data;
      if (d) useAuthStore.setState({ permissions: d.permissions ?? {}, granular: d.granular_permissions ?? [] });
    }).catch(() => { /* offline/401 tratado pelo interceptor */ });
  }, [isAuthenticated, role]);
  const mustChange      = useAuthStore(s => !!s.user?.must_change_password);
  if (!isAuthenticated) return <Navigate to="/login_paciente" replace />;
  // Senha provisória do administrador: só a tela de troca é acessível até definir a própria.
  if (mustChange && window.location.pathname !== '/trocar_senha') return <Navigate to="/trocar_senha" replace />;
  return <>{children}</>;
}

function PublicOnlyRoute({ children, redirectTo = '/' }: { children: React.ReactNode; redirectTo?: string }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const user            = useAuthStore(s => s.user);
  if (!isAuthenticated) return <>{children}</>;
  if (user?.role === 'patient') return <Navigate to="/portal_do_paciente" replace />;
  return <Navigate to={redirectTo} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Toaster />
        <CookieConsent />
        <BrowserRouter>
          <Routes>

          <Route path="/trocar_senha" element={<PrivateRoute><ChangePasswordPage /></PrivateRoute>} />
          <Route path="/login_paciente" element={<PublicOnlyRoute><LoginPaciente /></PublicOnlyRoute>} />
          <Route path="/login_medico"   element={<PublicOnlyRoute><LoginMedico /></PublicOnlyRoute>} />
          <Route path="/login_recepcao" element={<PublicOnlyRoute><LoginRecepcao /></PublicOnlyRoute>} />
          <Route path="/login_tecnico"  element={<PublicOnlyRoute><LoginTecnico /></PublicOnlyRoute>} />
          <Route path="/login_enfermeiro" element={<PublicOnlyRoute><LoginEnfermeiro /></PublicOnlyRoute>} />
          <Route path="/login_admin"    element={<PublicOnlyRoute><LoginAdmin /></PublicOnlyRoute>} />

          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Termos de Uso/Privacidade (LGPD) — rota pública, aberta em nova aba */}
          <Route path="/termos" element={<TermosDeUso />} />

          <Route path="/portal_do_paciente" element={<PortalDoPaciente />} />

          {/* Fora do AppLayout de propósito: viewer DICOM ocupa a tela cheia */}
          <Route path="/viewer/:studyUID" element={
            <PrivateRoute><OrthoVisPage /></PrivateRoute>
          } />

          <Route path="/painel" element={
            <PrivateRoute><RoleGuard resource="painel" redirectTo="/dashboard"><PainelPage /></RoleGuard></PrivateRoute>
          } />

          {/* Rota pública de propósito: o room_token (UUID não adivinhável) é a
              própria credencial de acesso à sala (capability-based access) */}
          <Route path="/tele/:token" element={<TeleRoomPage />} />

          <Route path="/" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
            <Route index element={<DashboardRedirect />} />

            <Route path="dashboard" element={
              <RoleGuard resource="dashboard"><DashboardPage /></RoleGuard>
            } />

            {/* Agendamento — recepção */}
            <Route path="appointments" element={
              <RoleGuard resource="appointments"><AppointmentsPage /></RoleGuard>
            } />

            {/* Pacientes — recepção (edição) + radiologista (leitura) */}
            <Route path="patients" element={
              <RoleGuard resource="patients_read"><PatientsPage /></RoleGuard>
            } />

            {/* Prontuário Eletrônico (PEP) — médico/técnico/radiologista/admin */}
            <Route path="patients/:id/chart" element={
              <RoleGuard resource="ehr"><PatientChartPage /></RoleGuard>
            } />

            {/* Fluxo de atendimento — painel de fila + medicação na unidade */}
            <Route path="atendimento" element={
              <RoleGuard resource="atendimento"><AtendimentoPage /></RoleGuard>
            } />
            {/* Atendimento médico dedicado (alergias, evolução, receita, medicação na unidade) */}
            <Route path="atendimento/consulta/:encounterId" element={
              <RoleGuard resource="ehr"><AtendimentoConsultaPage /></RoleGuard>
            } />
            <Route path="medicacao" element={
              <RoleGuard resource="medicacao"><MedicacaoPage /></RoleGuard>
            } />

            <Route path="farmacia" element={
              <RoleGuard resource="farmacia"><FarmaciaPage /></RoleGuard>
            } />
            <Route path="teleconsulta" element={
              <RoleGuard resource="teleconsulta"><TeleconsultaPage /></RoleGuard>
            } />
            <Route path="relatorios" element={
              <RoleGuard resource="relatorios"><RelatoriosPage /></RoleGuard>
            } />

            {/* Worklist — técnico + radiologista */}
            <Route path="worklist" element={
              <RoleGuard resource="worklist"><WorklistPage /></RoleGuard>
            } />

            {/* Estudos DICOM — técnico + radiologista */}
            <Route path="studies" element={
              <RoleGuard resource="studies"><StudiesPage /></RoleGuard>
            } />

            {/* Upload DICOM — técnico + admin */}
            <Route path="dicom-upload" element={
              <RoleGuard resource="dicom_upload"><DicomUploadPage /></RoleGuard>
            } />

            {/* Webviewer local — drop zone RIS-native; vira fullscreen quando carrega */}
            <Route path="webviewer" element={
              <RoleGuard resource="webviewer"><WebviewerPage /></RoleGuard>
            } />

            {/* Laudos — radiologista */}
            <Route path="reports" element={
              <RoleGuard resource="reports"><ReportsPage /></RoleGuard>
            } />

            {/* Conselho técnico — radiologista */}
            <Route path="second-opinion" element={
              <RoleGuard resource="second_opinion"><SecondOpinionPage /></RoleGuard>
            } />

            {/* Encaminhamentos — recepção/médico/radiologista/técnico/admin */}
            <Route path="referrals" element={
              <RoleGuard resource="referrals"><ReferralsInboxPage /></RoleGuard>
            } />

            {/* Procedimentos — técnico + admin */}
            <Route path="procedures" element={
              <RoleGuard resource="procedures_manage"><ProceduresPage /></RoleGuard>
            } />

            {/* Toda área /admin/* exige role admin via RoleGuard("settings") */}
            <Route path="admin" element={
              <RoleGuard resource="settings"><AdminHomePage /></RoleGuard>
            } />
            <Route path="admin/units" element={
              <RoleGuard resource="settings"><AdminUnitsPage /></RoleGuard>
            } />
            {/* Admin gere qualquer unidade; recepção só a sua (escopo no backend) */}
            <Route path="admin/units/:id" element={
              <RoleGuard resource="unit_manage"><UnitManagePage /></RoleGuard>
            } />
            <Route path="minha-unidade" element={
              <RoleGuard resource="unit_manage"><MyUnitRedirect /></RoleGuard>
            } />
            <Route path="admin/staff" element={
              <RoleGuard resource="settings"><AdminStaffPage /></RoleGuard>
            } />
            <Route path="admin/audit" element={
              <RoleGuard resource="settings"><AdminAuditPage /></RoleGuard>
            } />
          </Route>

          {/* 404 — qualquer URL não mapeada vira NotFoundPage,
              que decide o destino com base em autenticação/role */}
          <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

function MyUnitRedirect() {
  const user = useAuthStore(s => s.user);
  if (!user) return <Navigate to="/login_recepcao" replace />;
  if (user.role === 'admin') return <Navigate to="/admin/units" replace />;
  if (!user.health_unit_id)  return <Navigate to="/dashboard" replace />;
  return <Navigate to={`/admin/units/${user.health_unit_id}`} replace />;
}

// Visibilidade por unidade é aplicada no BACKEND (filtros por recurso nas
// queries), não na rota — por isso não há confinamento de URL aqui.
function DashboardRedirect() {
  const { user, can } = useAuthStore();

  if (!user) return <Navigate to="/login_paciente" replace />;
  if (user.role === 'patient') return <Navigate to="/portal_do_paciente" replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  if (user.role === 'nurse')  return <Navigate to="/medicacao"   replace />;

  if (can('dashboard'))    return <Navigate to="/dashboard"    replace />;
  if (can('worklist'))     return <Navigate to="/worklist"     replace />;
  if (can('appointments')) return <Navigate to="/appointments" replace />;

  return <Navigate to="/dashboard" replace />;
}
