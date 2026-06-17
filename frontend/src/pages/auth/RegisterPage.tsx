import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { authApi } from '../../api/auth'
import { useAuthStore } from '../../store/authStore'
import { Spinner } from '../../components/ui/Spinner'
import { AuroraBackground } from '../../components/ui/AuroraBackground'

interface FormState {
  email: string
  password: string
  confirm: string
  full_name: string
  company: string
}

interface Errors {
  email?: string
  password?: string
  confirm?: string
  full_name?: string
}

export default function RegisterPage() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const [form, setForm] = useState<FormState>({ email: '', password: '', confirm: '', full_name: '', company: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [loading, setLoading] = useState(false)

  function set(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  function validate() {
    const e: Errors = {}
    if (!form.email.includes('@')) e.email = 'Valid email required'
    if (form.password.length < 6) e.password = 'Minimum 6 characters'
    if (form.password !== form.confirm) e.confirm = 'Passwords do not match'
    if (!form.full_name.trim()) e.full_name = 'Name required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      const res = await authApi.register(form.email, form.password, form.full_name || undefined)
      setAuth(res.access_token, res.investor)
      toast.success('Account created')
      navigate('/dashboard')
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#0B0F0D] flex relative overflow-hidden" style={{ fontFamily: '"Hanken Grotesk", system-ui, sans-serif' }}>
      <AuroraBackground />
      {/* Left: brand panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 border-r border-white/[0.06] p-16 relative z-10 overflow-hidden">
        <div
          className="absolute bottom-0 left-0 right-0 leading-none font-thin text-white select-none pointer-events-none"
          style={{ fontSize: 'clamp(80px, 14vw, 200px)', opacity: 0.03, lineHeight: 0.85, letterSpacing: '-0.04em' }}
          aria-hidden
        >
          DISCOVER
        </div>

        <div>
          <span className="text-lg font-light tracking-[0.08em]">
            tunis<span className="text-gold">IA</span>
          </span>
        </div>

        <div>
          <p className="text-[11px] tracking-[0.2em] uppercase text-white/25 mb-4">01 / Get started</p>
          <p className="text-3xl font-thin leading-snug text-white" style={{ maxWidth: '380px' }}>
            Join a platform built for emerging market investors.
          </p>
        </div>
      </div>

      {/* Right: form */}
      <div className="flex-1 flex items-center justify-center p-8 relative z-10">
        <div className="w-full max-w-sm animate-slide-up">
          <div className="lg:hidden mb-10">
            <span className="text-xl font-light tracking-[0.08em]">
              tunis<span className="text-gold">IA</span>
            </span>
          </div>

          <p className="text-[11px] tracking-[0.2em] uppercase text-white/30 mb-6">Create account</p>
          <h1 className="text-2xl font-thin text-white mb-10 leading-tight">
            Start your journey
          </h1>

          <form onSubmit={onSubmit} className="space-y-7">
            <div>
              <label className="label-base">Full name</label>
              <input type="text" value={form.full_name} onChange={set('full_name')} placeholder="Jane Smith" className="input-base" autoComplete="name" />
              {errors.full_name && <p className="text-xs text-red-400 mt-2">{errors.full_name}</p>}
            </div>

            <div>
              <label className="label-base">Company (optional)</label>
              <input type="text" value={form.company} onChange={set('company')} placeholder="Acme Ventures" className="input-base" autoComplete="organization" />
            </div>

            <div>
              <label className="label-base">Email address</label>
              <input type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" className="input-base" autoComplete="email" />
              {errors.email && <p className="text-xs text-red-400 mt-2">{errors.email}</p>}
            </div>

            <div>
              <label className="label-base">Password</label>
              <input type="password" value={form.password} onChange={set('password')} placeholder="••••••••" className="input-base" autoComplete="new-password" />
              {errors.password && <p className="text-xs text-red-400 mt-2">{errors.password}</p>}
            </div>

            <div>
              <label className="label-base">Confirm password</label>
              <input type="password" value={form.confirm} onChange={set('confirm')} placeholder="••••••••" className="input-base" autoComplete="new-password" />
              {errors.confirm && <p className="text-xs text-red-400 mt-2">{errors.confirm}</p>}
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3 mt-2">
              {loading ? <Spinner size="sm" /> : 'Create account'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-white/[0.06]">
            <p className="text-sm font-light text-white/30">
              Already have an account?{' '}
              <Link to="/login" className="text-gold hover:text-white transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
