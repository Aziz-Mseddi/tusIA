import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Search,
  FlaskConical,
  BarChart3,
  MessageSquare,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { clsx } from 'clsx'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/mode1', icon: Search, label: 'Startup Explorer' },
  { to: '/mode2', icon: FlaskConical, label: 'Viability Check' },
  { to: '/monitoring', icon: BarChart3, label: 'My Investments' },
  { to: '/chat', icon: MessageSquare, label: 'AI Assistant' },
]

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 h-full z-40 flex flex-col transition-all duration-300',
        'border-r border-white/[0.05] backdrop-blur-xl',
        collapsed ? 'w-16' : 'w-60'
      )}
      style={{
        background: 'linear-gradient(180deg, #0A1628 0%, #07111E 100%)',
        boxShadow: '4px 0 24px rgba(0,0,0,0.4)',
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/[0.05]">
        <div className="relative flex-shrink-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shadow-glow-blue"
            style={{ background: 'linear-gradient(135deg, #2563EB 0%, #3B82F6 100%)' }}
          >
            <TrendingUp size={17} className="text-white" />
          </div>
          {/* Subtle outer ring */}
          <div
            className="absolute -inset-0.5 rounded-xl opacity-30 animate-pulse-glow pointer-events-none"
            style={{ border: '1px solid rgba(59,130,246,0.5)' }}
          />
        </div>

        {!collapsed && (
          <div className="overflow-hidden">
            <div className="font-bold text-sm text-white leading-tight whitespace-nowrap tracking-wide">
              TunisIA
            </div>
            <div
              className="text-[9px] whitespace-nowrap uppercase"
              style={{
                letterSpacing: '0.22em',
                background: 'linear-gradient(90deg, #3B82F6, #06B6D4)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Invest Intelligence
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              clsx(
                'relative flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-all duration-150',
                isActive ? 'nav-item-active' : 'nav-item-inactive'
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* Left accent bar on active */}
                {isActive && (
                  <span
                    className="absolute left-0 inset-y-0 my-auto rounded-r-full"
                    style={{
                      width: 2,
                      height: '65%',
                      background: 'linear-gradient(to bottom, transparent, #3B82F6, #06B6D4, transparent)',
                      boxShadow: '0 0 8px rgba(59,130,246,0.8)',
                    }}
                  />
                )}
                <item.icon
                  size={18}
                  className={clsx('flex-shrink-0 transition-colors duration-150', isActive ? 'text-primary' : '')}
                />
                {!collapsed && (
                  <span className="truncate">{item.label}</span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="p-2 border-t border-white/[0.05]">
        <button
          onClick={onToggle}
          className="flex items-center justify-center w-full py-2 text-text-muted hover:text-text-secondary hover:bg-white/[0.04] rounded-lg transition-colors duration-150"
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          {!collapsed && <span className="ml-2 text-[11px] tracking-wide">Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
