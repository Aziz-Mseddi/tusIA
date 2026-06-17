import { useEffect, useRef } from 'react'
import { X, Sun, Moon } from 'lucide-react'
import { useAppSettings } from '../../store/appSettingsStore'
import { clsx } from 'clsx'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { theme, setTheme, transparency, setTransparency } = useAppSettings()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  const isLight = theme === 'light'

  return (
    <>
      {/* Backdrop */}
      <div
        className={clsx(
          'fixed inset-0 z-40 transition-opacity duration-300',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={panelRef}
        className={clsx(
          'fixed right-0 top-0 bottom-0 z-50 w-[300px] flex flex-col',
          'transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
        style={{
          transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
          background: 'var(--panel-bg)',
          borderLeft: '1px solid var(--panel-border)',
        }}
      >
        {/* ── Header ────────────────────────────── */}
        <div
          className="flex items-center justify-between px-5 h-14 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--panel-border)' }}
        >
          <span
            className="text-[10px] tracking-[0.22em] uppercase font-normal"
            style={{ color: 'var(--panel-text-muted)' }}
          >
            Settings
          </span>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-sm transition-colors"
            style={{ color: 'var(--panel-text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--panel-text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--panel-text-muted)')}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Body ──────────────────────────────── */}
        <div className="flex-1 overflow-y-auto py-6 px-5 space-y-8">

          {/* ── Appearance section ──────────────── */}
          <section>
            <p
              className="text-[9px] tracking-[0.22em] uppercase mb-3.5"
              style={{ color: 'var(--panel-text-muted)' }}
            >
              Appearance
            </p>

            {/* Theme card */}
            <div
              className="flex items-center justify-between px-4 py-3.5"
              style={{
                background: 'var(--panel-surface)',
                border: '1px solid var(--panel-border)',
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 flex items-center justify-center flex-shrink-0"
                  style={{
                    background: 'rgba(196,165,114,0.1)',
                    border: '1px solid rgba(196,165,114,0.2)',
                  }}
                >
                  {isLight
                    ? <Sun size={14} style={{ color: '#C4A572' }} />
                    : <Moon size={14} style={{ color: '#C4A572' }} />
                  }
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--panel-text)' }}>
                    {isLight ? 'Light Mode' : 'Dark Mode'}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--panel-text-muted)' }}>
                    {isLight ? 'Warm parchment' : 'Deep navy'}
                  </p>
                </div>
              </div>

              {/* iOS-style toggle */}
              <button
                onClick={() => setTheme(isLight ? 'dark' : 'light')}
                className="relative flex-shrink-0 w-11 h-[22px] transition-colors duration-300 focus:outline-none"
                style={{
                  background: isLight ? '#C4A572' : 'rgba(236,231,219,0.10)',
                  border: isLight ? '1px solid rgba(180,149,105,0.8)' : '1px solid rgba(236,231,219,0.12)',
                  borderRadius: '11px',
                }}
              >
                <span
                  className="absolute top-[2px] flex items-center justify-center w-[18px] h-[18px] rounded-full transition-transform duration-300"
                  style={{
                    background: '#fff',
                    transform: isLight ? 'translateX(21px)' : 'translateX(2px)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                  }}
                >
                  {isLight
                    ? <Sun size={9} style={{ color: '#C4A572' }} />
                    : <Moon size={9} style={{ color: '#374151' }} />
                  }
                </span>
              </button>
            </div>

            {/* Transparency card */}
            <div
              className="px-4 py-3.5 mt-2.5"
              style={{
                background: 'var(--panel-surface)',
                border: '1px solid var(--panel-border)',
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs" style={{ color: 'var(--panel-text)' }}>
                    Transparency
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--panel-text-muted)' }}>
                    Panel see-through
                  </p>
                </div>
                <span
                  className="text-[10px] tabular-nums"
                  style={{ color: '#C4A572', fontFamily: '"IBM Plex Mono", monospace' }}
                >
                  {transparency}%
                </span>
              </div>
              <input
                type="range"
                min={40}
                max={100}
                step={2}
                value={transparency}
                onChange={(e) => setTransparency(Number(e.target.value))}
                aria-label="Panel transparency"
                className="w-full h-1 cursor-pointer appearance-none rounded-full"
                style={{
                  accentColor: '#C4A572',
                  background: 'var(--hairline-strong)',
                }}
              />
              <div
                className="flex items-center justify-between mt-2 text-[9px] tracking-[0.12em] uppercase"
                style={{ color: 'var(--panel-text-muted)' }}
              >
                <span>See-through</span>
                <span>Solid</span>
              </div>
            </div>
          </section>

          {/* ── About section ────────────────────── */}
          <section>
            <p
              className="text-[9px] tracking-[0.22em] uppercase mb-3.5"
              style={{ color: 'var(--panel-text-muted)' }}
            >
              About
            </p>
            <div
              className="px-4 py-3 space-y-2"
              style={{ border: '1px solid var(--panel-border)' }}
            >
              {([
                ['Platform', 'TunisIA Invest'],
                ['AI Engine', 'Ollama / OpenRouter'],
                ['Version', '1.0.0'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: 'var(--panel-text-muted)' }}>{k}</span>
                  <span
                    className="text-[10px]"
                    style={{ color: 'var(--panel-text)', fontFamily: '"IBM Plex Mono", monospace' }}
                  >
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* ── Footer ────────────────────────────── */}
        <div
          className="px-5 py-3.5 flex-shrink-0"
          style={{ borderTop: '1px solid var(--panel-border)' }}
        >
          <p className="text-[9px] tracking-wider text-center" style={{ color: 'var(--panel-text-muted)' }}>
            TUNIS<span style={{ color: '#C4A572' }}>IA</span> · INVEST
          </p>
        </div>
      </div>
    </>
  )
}
