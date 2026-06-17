import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './store/authStore'
import { CursorGlow } from './components/ui/CursorGlow'
import { TopProgressBar } from './components/ui/TopProgressBar'

import LoginPage from './pages/auth/LoginPage'
import RegisterPage from './pages/auth/RegisterPage'
import Dashboard from './pages/Dashboard'
import Mode1Page from './pages/mode1/Mode1Page'
import StartupDetailPage from './pages/mode1/StartupDetailPage'
import Mode2Page from './pages/mode2/Mode2Page'
import InvestmentsPage from './pages/monitoring/InvestmentsPage'
import GlobalDashboardPage from './pages/monitoring/GlobalDashboardPage'
import InvestmentDashboardPage from './pages/monitoring/InvestmentDashboardPage'
import WeeklyDigestPage from './pages/monitoring/WeeklyDigestPage'
import ChatPage from './pages/ChatPage'

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  return !isAuthenticated ? <>{children}</> : <Navigate to="/dashboard" replace />
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <TopProgressBar />
      <CursorGlow />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
          <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/mode1" element={<PrivateRoute><Mode1Page /></PrivateRoute>} />
          <Route path="/mode1/startup/:id" element={<PrivateRoute><StartupDetailPage /></PrivateRoute>} />
          <Route path="/mode2" element={<PrivateRoute><Mode2Page /></PrivateRoute>} />
          <Route path="/monitoring" element={<PrivateRoute><InvestmentsPage /></PrivateRoute>} />
          <Route path="/monitoring/global" element={<PrivateRoute><GlobalDashboardPage /></PrivateRoute>} />
          <Route path="/monitoring/:id" element={<PrivateRoute><InvestmentDashboardPage /></PrivateRoute>} />
          <Route path="/digest" element={<PrivateRoute><WeeklyDigestPage /></PrivateRoute>} />
          <Route path="/chat" element={<PrivateRoute><ChatPage /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>

      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--panel-bg)',
            color: 'var(--panel-text)',
            border: '1px solid var(--panel-border)',
            borderRadius: '0',
            fontSize: '13px',
            fontFamily: '"Hanken Grotesk", system-ui, sans-serif',
            fontWeight: 300,
          },
          success: { iconTheme: { primary: '#C4A572', secondary: 'var(--panel-bg)' } },
          error: { iconTheme: { primary: '#C58A6B', secondary: 'var(--panel-bg)' } },
        }}
      />
    </QueryClientProvider>
  )
}
