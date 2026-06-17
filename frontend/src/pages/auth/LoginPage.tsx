import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { authApi } from '../../api/auth'
import { useAuthStore } from '../../store/authStore'
import { Spinner } from '../../components/ui/Spinner'
import { AuroraBackground } from '../../components/ui/AuroraBackground'

export default function LoginPage() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})

  function validate() {
    const e: typeof errors = {}
    if (!email.includes('@')) e.email = 'Valid email required'
    if (password.length < 6) e.password = 'Minimum 6 characters'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      const res = await authApi.login(email, password)
      setAuth(res.access_token, res.investor)
      toast.success('Welcome back')
      navigate('/dashboard')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#0B0F0D] flex relative overflow-hidden" style={{ fontFamily: '"Hanken Grotesk", system-ui, sans-serif' }}>
      <AuroraBackground />
      {/* Left: brand panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 border-r border-white/[0.06] p-16 relative z-10 overflow-hidden">
        {/* Giant background word */}
        <div
          className="absolute bottom-0 left-0 right-0 leading-none font-thin text-white select-none pointer-events-none"
          style={{ fontSize: 'clamp(100px, 18vw, 240px)', opacity: 0.03, lineHeight: 0.85, letterSpacing: '-0.04em' }}
          aria-hidden
        >
          INVEST
        </div>

        {/* Logo */}
        <div>
          <span className="text-lg font-light tracking-[0.08em]">
            tunis<span className="text-gold">IA</span>
          </span>
        </div>

        {/* Tagline */}
        <div>
          <p className="text-[11px] tracking-[0.2em] uppercase text-white/25 mb-4">Investment Intelligence</p>
          <p className="text-3xl font-thin leading-snug text-white" style={{ maxWidth: '380px' }}>
            Private equity tools for emerging markets.
          </p>
        </div>
      </div>

      {/* Right: form */}
      <div className="flex-1 flex items-center justify-center p-8 relative z-10">
        <div className="w-full max-w-sm animate-slide-up">
          {/* Mobile logo */}
          <div className="lg:hidden mb-10">
            <span className="text-xl font-light tracking-[0.08em]">
              tunis<span className="text-gold">IA</span>
            </span>
          </div>

          <p className="text-[11px] tracking-[0.2em] uppercase text-white/30 mb-6">Sign in</p>
          <h1 className="text-2xl font-thin text-white mb-10 leading-tight">
            Access your platform
          </h1>

          <form onSubmit={onSubmit} className="space-y-8">
            <div>
              <label className="label-base">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input-base"
                autoComplete="email"
              />
              {errors.email && <p className="text-xs text-red-400 mt-2">{errors.email}</p>}
            </div>

            <div>
              <label className="label-base">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-base"
                autoComplete="current-password"
              />
              {errors.password && <p className="text-xs text-red-400 mt-2">{errors.password}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-3 mt-2"
            >
              {loading ? <Spinner size="sm" /> : 'Enter'}
            </button>
          </form>

          <div className="mt-10 pt-6 border-t border-white/[0.06]">
            <p className="text-sm font-light text-white/30">
              No account?{' '}
              <Link to="/register" className="text-gold hover:text-white transition-colors">
                Register here
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
