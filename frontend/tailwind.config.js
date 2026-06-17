/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0B0F0D',
        surface: '#10150F',
        'surface-2': '#161C15',
        'border-dim': 'rgba(236,231,219,0.06)',
        'border-mid': 'rgba(236,231,219,0.10)',
        // Bone override — every `text-white`, `bg-white/[x]`, `border-white/[x]`
        // utility now resolves to warm ivory instead of pure white.
        white: '#ECE7DB',
        gold: {
          DEFAULT: '#C4A572',
          bright: '#DBC08C',
          dim: 'rgba(196,165,114,0.10)',
          glow: 'rgba(196,165,114,0.25)',
        },
        success: '#8FA982',
        warning: '#C4A572',
        danger: '#C58A6B',
        critical: '#B36B4C',
        text: {
          primary: '#ECE7DB',
          secondary: '#8C948A',
          muted: 'rgba(236,231,219,0.38)',
        },
        // Legacy compat
        primary: {
          DEFAULT: '#C4A572',
          dark: '#a8895c',
          glow: 'rgba(196,165,114,0.25)',
        },
        accent: {
          DEFAULT: '#C4A572',
          glow: 'rgba(196,165,114,0.25)',
        },
      },
      fontFamily: {
        sans: ['"Hanken Grotesk"', 'system-ui', 'sans-serif'],
        display: ['"Fraunces"', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'Consolas', 'monospace'],
      },
      fontWeight: {
        thin: '200',
        light: '300',
        normal: '400',
        medium: '400',
        semibold: '600',
        bold: '700',
      },
      letterSpacing: {
        widest: '0.2em',
        wider: '0.1em',
      },
      boxShadow: {
        card: '0 1px 0 rgba(0,0,0,0.4), 0 12px 40px rgba(0,0,0,0.35)',
        'card-hover': '0 20px 60px rgba(0,0,0,0.5)',
        'glow-gold': '0 0 24px rgba(196,165,114,0.25)',
        'glow-gold-lg': '0 0 48px rgba(196,165,114,0.4)',
        'glow-blue': '0 0 20px rgba(196,165,114,0.2)',
        'glow-blue-lg': '0 0 40px rgba(196,165,114,0.35)',
        'glow-amber': '0 0 20px rgba(196,165,114,0.3)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s cubic-bezier(0.22,1,0.36,1)',
        'slide-up': 'slideUp 0.5s cubic-bezier(0.22,1,0.36,1)',
        'stagger-1': 'slideUp 0.32s cubic-bezier(0.22,1,0.36,1) 0.06s both',
        'stagger-2': 'slideUp 0.32s cubic-bezier(0.22,1,0.36,1) 0.14s both',
        'stagger-3': 'slideUp 0.32s cubic-bezier(0.22,1,0.36,1) 0.22s both',
        'stagger-4': 'slideUp 0.32s cubic-bezier(0.22,1,0.36,1) 0.30s both',
        'pulse-slow': 'pulse 4s ease-in-out infinite',
        'spin-slow': 'spin 8s linear infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0.35', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
