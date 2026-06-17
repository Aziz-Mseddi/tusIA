import { useState, useRef, useEffect } from 'react'
import { User, LogOut, ChevronDown, Wifi, WifiOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useQuery } from '@tanstack/react-query'
import { startupsApi } from '../../api/startups'

interface HeaderProps {
  title: string
  sidebarCollapsed: boolean
}

export function Header({ title, sidebarCollapsed }: HeaderProps) {
  const { investor, logout } = useAuthStore()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: startupsApi.health,
    refetchInterval: 30_000,
    staleTime: 20_000,
  })

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const ollamaOk = health?.ollama_available

  return (
    <header
      className="fixed top-0 right-0 z-30 flex items-center justify-between px-6 py-3 backdrop-blur-xl transition-all duration-300"
      style={{
        left: sidebarCollapsed ? 64 : 240,
        background: 'rgba(7,17,30,0.85)',
        borderBottom: '1px solid rgba(255,255,255,0.045)',
      }}
    >
      {/* Animated gradient bottom line */}
      <div
        className="absolute bottom-0 left-0 right-0 h-px pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(59,130,246,0.45) 30%, rgba(124,58,237,0.3) 60%, transparent 100%)',
          backgroundSize: '200% 100%',
          animation: 'aurora 5s ease infinite',
        }}
      />

      <h1 className="text-sm font-semibold text-text-primary tracking-wide">{title}</h1>

      <div className="flex items-center gap-4">
        {/* Ollama status */}
        <div className="flex items-center gap-1.5 text-xs">
          {ollamaOk ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-success/20 bg-success/[0.06]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
              </span>
              <span className="text-success font-medium hidden sm:inline">AI Online</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/[0.07] bg-white/[0.03]">
              <WifiOff size={11} className="text-text-muted" />
              <span className="text-text-muted hidden sm:inline">AI Offline</span>
            </div>
          )}
        </div>

        {/* Profile menu */}
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.05] transition-colors duration-150"
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, rgba(59,130,246,0.25), rgba(124,58,237,0.2))',
                border: '1px solid rgba(59,130,246,0.3)',
              }}
            >
              <User size={13} className="text-primary" />
            </div>
            <span className="text-sm text-text-secondary hidden sm:inline max-w-[120px] truncate">
              {investor?.full_name || investor?.email}
            </span>
            <ChevronDown
              size={13}
              className="text-text-muted transition-transform duration-150"
              style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
            />
          </button>

          {open && (
            <div className="absolute right-0 mt-1.5 w-52 glass-card shadow-card-hover py-1 animate-fade-in">
              <div className="px-3 py-2.5 border-b border-white/[0.06]">
                <p className="text-xs font-semibold text-text-primary truncate">
                  {investor?.full_name || 'Investor'}
                </p>
                <p className="text-[11px] text-text-muted truncate mt-0.5">{investor?.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-danger hover:bg-red-500/10 transition-colors duration-150"
              >
                <LogOut size={13} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
