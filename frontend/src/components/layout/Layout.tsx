import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { clsx } from 'clsx'
import { AuroraBackground } from '../ui/AuroraBackground'
import { SettingsPanel } from '../ui/SettingsPanel'
import { Settings } from 'lucide-react'

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Discover', path: '/mode1' },
  { label: 'Assess', path: '/mode2' },
  { label: 'Monitor', path: '/monitoring' },
  { label: 'Global View', path: '/monitoring/global' },
  { label: 'This Week', path: '/digest' },
  { label: 'Chat', path: '/chat' },
]

function TopNav() {
  const { investor, logout } = useAuthStore()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-white/[0.06] flex items-center px-8"
        style={{ background: 'var(--bg-nav)' }}
      >
        {/* Logo */}
        <NavLink to="/dashboard" className="flex items-center gap-0 mr-12 flex-shrink-0">
          <span className="text-white font-light tracking-[0.08em] text-base">tunis</span>
          <span className="text-gold font-light tracking-[0.08em] text-base">IA</span>
        </NavLink>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-8 flex-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                isActive ? 'nav-link-active' : 'nav-link'
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User area */}
        <div className="flex items-center gap-3 ml-auto">
          <span className="hidden sm:block text-[11px] text-white/30 tracking-wider">
            {investor?.full_name ?? investor?.email?.split('@')[0]}
          </span>
          <button
            onClick={handleLogout}
            className="text-[11px] tracking-[0.18em] uppercase text-white/30 hover:text-white transition-colors"
          >
            Exit
          </button>

          {/* Settings button */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center justify-center w-7 h-7 text-white/30 hover:text-white transition-colors"
            title="Settings"
          >
            <Settings size={14} />
          </button>

          {/* Mobile hamburger */}
          <button
            className="md:hidden text-white/50 hover:text-white ml-1"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              {menuOpen
                ? <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                : <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              }
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div
            className="absolute top-14 left-0 right-0 border-b border-white/[0.06] py-4 px-8 flex flex-col gap-4 md:hidden"
            style={{ background: 'var(--bg-base)' }}
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  isActive ? 'nav-link-active' : 'nav-link'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        )}
      </header>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}

interface LayoutProps {
  title?: string
  children: ReactNode
  fullWidth?: boolean
}

export function Layout({ children, fullWidth }: LayoutProps) {
  const { pathname } = useLocation()
  return (
    <div className="min-h-[100dvh]" style={{ background: 'var(--bg-base)' }}>
      {/* Site-wide animated gold-beam backdrop. Rendered here at the Layout root
          (outside <main>) so its position:fixed isn't boxed by <main>'s
          animate-route transform — it fills the whole viewport. */}
      <AuroraBackground />

      <TopNav />

      <main
        key={pathname}
        className={clsx(
          'relative pt-14 animate-route',
          fullWidth ? '' : 'max-w-7xl mx-auto px-8',
        )}
        style={{ zIndex: 10 }}
      >
        {children}
      </main>
    </div>
  )
}
