import type { CSSProperties } from 'react'
import { useAppSettings } from '../../store/appSettingsStore'

/**
 * Fixed full-screen atmospheric backdrop for the AI Assistant — a column of
 * swaying gold light ribbons, a curtain of flowing vertical streaks, a soft
 * arc of light, an animated grain layer and a vignette. Pure CSS animation;
 * sits behind the chat content (zIndex 0, pointer-events none).
 *
 * Ported 1:1 from the approved "AI Assistant — Animated" mockup. The light
 * branch matches the "parchment ledger" light-mode reference: warm parchment
 * radial base with soft, low-opacity brass ribbons (no dark vignette).
 */

// Flowing vertical streaks: [left%, height%, width px, opacity, rotateDeg, flowDur, delay, center]
// Center streaks (center=1) are slower, dimmer, heavier-blurred and steady (no flicker) so
// they recede behind content; side streaks (center=0) keep the livelier flow + flicker.
const STREAKS: [number, number, number, number, number, number, number, number][] = [
  [49.2, 96, 2, 0.26, -2, 11, 0, 1],
  [50.4, 82, 1.5, 0.2, -1.2, 13, 1.2, 1],
  [51.4, 104, 2.5, 0.28, 0, 10, 0.5, 1],
  [52.3, 74, 1, 0.16, 0.8, 14, 2.1, 1],
  [53.4, 92, 2, 0.24, 1.6, 12, 0.9, 1],
  [54.6, 66, 1, 0.14, 2.4, 15, 3, 1],
  [55.8, 86, 1.5, 0.19, 3.2, 11.5, 1.7, 1],
  [22.5, 70, 1, 0.28, -3, 8.5, 0.4, 0],
  [24.2, 88, 1.5, 0.34, -2, 7.4, 2.6, 0],
]

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")"

const maskArc =
  'linear-gradient(90deg, transparent 0%, #000 25%, #000 75%, transparent 100%)'

// Theme-keyed palette. Light values match the reference parchment mockup;
// dark values are the original 1:1 port (unchanged).
const PALETTES = {
  dark: {
    container:
      'radial-gradient(130% 90% at 50% 0%, #0C110E 0%, #0B0F0D 55%, #060907 100%)',
    ribbonBroad:
      'linear-gradient(180deg, rgba(196,165,114,0) 0%, rgba(196,165,114,0.16) 28%, rgba(219,192,140,0.26) 52%, rgba(196,165,114,0.10) 74%, rgba(196,165,114,0) 100%)',
    ribbonCore:
      'linear-gradient(180deg, rgba(219,192,140,0) 0%, rgba(219,192,140,0.30) 40%, rgba(219,192,140,0.16) 65%, rgba(219,192,140,0) 100%)',
    haze:
      'linear-gradient(180deg, rgba(196,165,114,0) 0%, rgba(196,165,114,0.10) 40%, rgba(196,165,114,0.05) 70%, rgba(196,165,114,0) 100%)',
    streak:
      'linear-gradient(180deg, rgba(219,192,140,0) 0%, rgba(219,192,140,0.95) 45%, rgba(196,165,114,0.55) 60%, rgba(219,192,140,0) 100%)',
    arcThin: '2px solid rgba(219,192,140,0.55)',
    arcWide: '7px solid rgba(196,165,114,0.22)',
    grainOpacity: 0.07,
    grainBlend: 'overlay' as const,
    vignette:
      'radial-gradient(120% 100% at 50% 42%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.55) 100%)',
    streakOpacityScale: 1,
    cornerGlowTL:
      'radial-gradient(circle at 32% 32%, rgba(196,165,114,0.11) 0%, rgba(196,165,114,0) 68%)',
    cornerGlowBR:
      'radial-gradient(circle at 68% 68%, rgba(219,192,140,0.10) 0%, rgba(196,165,114,0) 66%)',
    cornerGlowBL:
      'radial-gradient(circle at 30% 70%, rgba(196,165,114,0.07) 0%, rgba(196,165,114,0) 70%)',
    edgeStreak:
      'linear-gradient(180deg, rgba(219,192,140,0) 0%, rgba(219,192,140,0.5) 50%, rgba(219,192,140,0) 100%)',
    topGlint:
      'linear-gradient(90deg, rgba(219,192,140,0) 0%, rgba(219,192,140,0.55) 50%, rgba(219,192,140,0) 100%)',
    bottomGlint:
      'linear-gradient(90deg, rgba(196,165,114,0) 0%, rgba(196,165,114,0.45) 50%, rgba(196,165,114,0) 100%)',
  },
  light: {
    // Darker brass + higher opacity than dark-mode gold: light gold washes out on
    // the parchment base, so we use a deeper tone at full strength to make the same
    // ribbons / streaks / corner glows read just as clearly as in dark mode.
    container:
      'radial-gradient(125% 90% at 50% 0%, #FCF8EF 0%, #F4EDDE 54%, #EEE5D3 100%)',
    ribbonBroad:
      'linear-gradient(180deg, rgba(138,106,57,0) 0%, rgba(138,106,57,0.20) 28%, rgba(122,92,46,0.30) 52%, rgba(138,106,57,0.14) 74%, rgba(138,106,57,0) 100%)',
    ribbonCore:
      'linear-gradient(180deg, rgba(122,92,46,0) 0%, rgba(122,92,46,0.34) 40%, rgba(122,92,46,0.18) 65%, rgba(122,92,46,0) 100%)',
    haze:
      'linear-gradient(180deg, rgba(138,106,57,0) 0%, rgba(138,106,57,0.12) 40%, rgba(138,106,57,0.06) 70%, rgba(138,106,57,0) 100%)',
    streak:
      'linear-gradient(180deg, rgba(122,92,46,0) 0%, rgba(122,92,46,0.85) 45%, rgba(138,106,57,0.5) 60%, rgba(122,92,46,0) 100%)',
    arcThin: '2px solid rgba(122,92,46,0.6)',
    arcWide: '7px solid rgba(138,106,57,0.28)',
    grainOpacity: 0.05,
    grainBlend: 'multiply' as const,
    vignette:
      'radial-gradient(120% 100% at 50% 42%, rgba(0,0,0,0) 60%, rgba(70,56,30,0.06) 100%)',
    streakOpacityScale: 1,
    cornerGlowTL:
      'radial-gradient(circle at 32% 32%, rgba(138,106,57,0.18) 0%, rgba(138,106,57,0) 68%)',
    cornerGlowBR:
      'radial-gradient(circle at 68% 68%, rgba(122,92,46,0.16) 0%, rgba(138,106,57,0) 66%)',
    cornerGlowBL:
      'radial-gradient(circle at 30% 70%, rgba(138,106,57,0.12) 0%, rgba(138,106,57,0) 70%)',
    edgeStreak:
      'linear-gradient(180deg, rgba(122,92,46,0) 0%, rgba(122,92,46,0.55) 50%, rgba(122,92,46,0) 100%)',
    topGlint:
      'linear-gradient(90deg, rgba(122,92,46,0) 0%, rgba(122,92,46,0.55) 50%, rgba(122,92,46,0) 100%)',
    bottomGlint:
      'linear-gradient(90deg, rgba(138,106,57,0) 0%, rgba(138,106,57,0.5) 50%, rgba(138,106,57,0) 100%)',
  },
}

export function AuroraBackground() {
  const theme = useAppSettings((s) => s.theme)
  const p = PALETTES[theme === 'light' ? 'light' : 'dark']

  const container: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
    background: p.container,
  }

  return (
    <div className="aurora-bg" style={container} aria-hidden>
      {/* Broad swaying ribbon */}
      <div
        style={{
          position: 'absolute',
          left: '13%',
          top: '-12%',
          width: 240,
          height: '125%',
          background: p.ribbonBroad,
          filter: 'blur(46px)',
          animation:
            'auroraSway 16s ease-in-out infinite alternate, auroraFlicker 9s ease-in-out infinite',
        }}
      />
      {/* Bright ribbon core */}
      <div
        style={{
          position: 'absolute',
          left: '17%',
          top: '-8%',
          width: 56,
          height: '116%',
          background: p.ribbonCore,
          filter: 'blur(16px)',
          animation:
            'auroraSway 16s ease-in-out infinite alternate, auroraFlicker 7s ease-in-out 1.5s infinite',
        }}
      />
      {/* Centre haze */}
      <div
        style={{
          position: 'absolute',
          left: '45%',
          top: '-10%',
          width: 320,
          height: '120%',
          background: p.haze,
          filter: 'blur(50px)',
          animation: 'auroraFlicker 20s ease-in-out 2s infinite',
        }}
      />

      {/* Flowing vertical streaks */}
      {STREAKS.map((s, i) => {
        const center = s[7] === 1
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${s[0]}%`,
              top: '-8%',
              height: `${s[1]}%`,
              width: s[2],
              transform: `rotate(${s[4]}deg)`,
              transformOrigin: 'top center',
              opacity: s[3] * p.streakOpacityScale,
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                background: p.streak,
                backgroundSize: '100% 240%',
                filter: center ? 'blur(1.4px)' : 'blur(0.5px)',
                animation: center
                  ? `streakFlow ${s[5]}s linear ${s[6]}s infinite`
                  : `streakFlow ${s[5]}s linear ${s[6]}s infinite, auroraFlicker ${s[5] * 1.7}s ease-in-out ${s[6]}s infinite`,
              }}
            />
          </div>
        )
      })}

      {/* Soft arc of light, lower-right */}
      <div
        style={{
          position: 'absolute',
          right: '-14%',
          bottom: '2%',
          width: 700,
          height: 420,
          transform: 'rotate(-14deg)',
          WebkitMaskImage: maskArc,
          maskImage: maskArc,
          animation: 'auroraFlicker 11s ease-in-out 1s infinite',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            borderTop: p.arcThin,
            filter: 'blur(1px)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            borderTop: p.arcWide,
            filter: 'blur(10px)',
          }}
        />
      </div>

      {/* Corner breathing glows — slow brass blooms anchored to the frame corners */}
      <div
        style={{
          position: 'absolute',
          left: '-7%',
          top: '-9%',
          width: 380,
          height: 380,
          background: p.cornerGlowTL,
          filter: 'blur(8px)',
          animation: 'edgeBreathe 15s ease-in-out infinite',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: '-9%',
          bottom: '-11%',
          width: 480,
          height: 480,
          background: p.cornerGlowBR,
          filter: 'blur(10px)',
          animation: 'edgeBreathe 19s ease-in-out 2.5s infinite',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '-10%',
          bottom: '-12%',
          width: 340,
          height: 340,
          background: p.cornerGlowBL,
          filter: 'blur(10px)',
          animation: 'edgeBreathe 22s ease-in-out 5s infinite',
        }}
      />

      {/* Edge light streaks — flowing vertical light hugging the left/right frame */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 2,
          height: '100%',
          background: p.edgeStreak,
          backgroundSize: '100% 240%',
          filter: 'blur(0.8px)',
          opacity: 0.5 * p.streakOpacityScale,
          animation: 'streakFlow 24s linear infinite, edgeBreathe 12s ease-in-out infinite',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: 2,
          height: '100%',
          background: p.edgeStreak,
          backgroundSize: '100% 240%',
          filter: 'blur(0.8px)',
          opacity: 0.5 * p.streakOpacityScale,
          animation: 'streakFlow 28s linear 4s infinite, edgeBreathe 14s ease-in-out 2s infinite',
        }}
      />

      {/* Edge glints — thin horizontal lights sweeping along the top/bottom edges */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: 2,
          width: '24%',
          background: p.topGlint,
          filter: 'blur(0.4px)',
          animation: 'edgeSweepX 26s ease-in-out infinite',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: 2,
          width: '20%',
          background: p.bottomGlint,
          filter: 'blur(0.4px)',
          animation: 'edgeSweepXRev 32s ease-in-out 6s infinite',
        }}
      />

      {/* Animated grain */}
      <div
        style={{
          position: 'absolute',
          inset: '-4%',
          backgroundImage: NOISE,
          backgroundSize: '220px 220px',
          opacity: p.grainOpacity,
          mixBlendMode: p.grainBlend,
          animation: 'grainShift 0.9s steps(3) infinite',
        }}
      />
      {/* Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: p.vignette,
        }}
      />
    </div>
  )
}
