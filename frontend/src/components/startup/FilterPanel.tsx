import { useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { clsx } from 'clsx'
import type { FilterRequest, StartupMeta } from '../../types'

const STAGES = ['creation', 'development', 'restructuring']
const MODELS = ['B2B', 'B2C', 'B2B2C', 'Marketplace']
const EXIT = ['active', 'failed', 'acquired', 'ipo']

interface FilterPanelProps {
  meta: StartupMeta
  filters: FilterRequest
  onChange: (f: FilterRequest) => void
  onReset: () => void
}

function toggle(arr: string[] | undefined, val: string): string[] {
  const a = arr ?? []
  return a.includes(val) ? a.filter((x) => x !== val) : [...a, val]
}

function Chip({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={clsx(
        'px-2.5 py-1 text-[11px] tracking-wide border transition-all duration-100',
        active
          ? 'border-gold text-gold'
          : 'border-white/10 text-white/35 hover:border-white/25 hover:text-white/60'
      )}
    >
      {label}
    </button>
  )
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-white/[0.06] pb-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-2.5 text-[11px] tracking-widest uppercase text-white/30 hover:text-white/60"
      >
        {title}
        {open ? <ChevronUp size={12} strokeWidth={1.5} /> : <ChevronDown size={12} strokeWidth={1.5} />}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

function RangeRow({
  filters,
  minKey,
  maxKey,
  placeholder,
  onChange,
  step = 1,
  hint,
}: {
  filters: FilterRequest
  minKey: keyof FilterRequest
  maxKey: keyof FilterRequest
  placeholder?: [string, string]
  onChange: (f: FilterRequest) => void
  step?: number
  hint?: string
}) {
  const minVal = filters[minKey] as number | undefined
  const maxVal = filters[maxKey] as number | undefined
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label-base">Min</label>
          <input
            type="number"
            step={step}
            value={minVal ?? ''}
            onChange={(e) =>
              onChange({ ...filters, [minKey]: e.target.value ? +e.target.value : undefined })
            }
            className="input-base text-xs"
            placeholder={placeholder?.[0] ?? '0'}
          />
        </div>
        <div>
          <label className="label-base">Max</label>
          <input
            type="number"
            step={step}
            value={maxVal ?? ''}
            onChange={(e) =>
              onChange({ ...filters, [maxKey]: e.target.value ? +e.target.value : undefined })
            }
            className="input-base text-xs"
            placeholder={placeholder?.[1] ?? 'any'}
          />
        </div>
      </div>
      {hint && <p className="text-[10px] text-white/20 mt-1.5 tracking-wide">{hint}</p>}
    </div>
  )
}

export function FilterPanel({ meta, filters, onChange, onReset }: FilterPanelProps) {
  const hasRange = (minKey: keyof FilterRequest, maxKey: keyof FilterRequest) =>
    filters[minKey] != null || filters[maxKey] != null ? 1 : 0

  const activeCount = [
    filters.sectors?.length ?? 0,
    filters.countries?.length ?? 0,
    filters.regions?.length ?? 0,
    filters.stages?.length ?? 0,
    filters.business_models?.length ?? 0,
    filters.exit_statuses?.length ?? 0,
    filters.sub_sectors?.length ?? 0,
    filters.tech_enabled != null ? 1 : 0,
    hasRange('min_employees', 'max_employees'),
    hasRange('min_founded_year', 'max_founded_year'),
    hasRange('min_age_years', 'max_age_years'),
    hasRange('min_revenue_usd', 'max_revenue_usd'),
    hasRange('min_revenue_cagr', 'max_revenue_cagr'),
    hasRange('min_ebitda_margin', 'max_ebitda_margin'),
    hasRange('min_market_size_M', 'max_market_size_M'),
    hasRange('min_market_growth_rate', 'max_market_growth_rate'),
    hasRange('min_competition_intensity', 'max_competition_intensity'),
    hasRange('min_regulatory_stability', 'max_regulatory_stability'),
    hasRange('min_esg_score', 'max_esg_score'),
  ].reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-0">
      <div className="flex items-center justify-between pb-4 border-b border-white/[0.06]">
        <span className="text-[11px] tracking-widest uppercase text-white/40">Filters</span>
        {activeCount > 0 && (
          <button
            onClick={onReset}
            className="flex items-center gap-1 text-[11px] text-red-400/70 hover:text-red-400 tracking-wide"
          >
            <X size={11} /> Reset ({activeCount})
          </button>
        )}
      </div>

      {/* ── Categorical ──────────────────────────────── */}

      <Section title="Sectors">
        <div className="flex flex-wrap gap-1.5">
          {meta.sectors.map((s) => (
            <Chip
              key={s.name}
              label={s.name}
              active={filters.sectors?.includes(s.name) ?? false}
              onToggle={() => onChange({ ...filters, sectors: toggle(filters.sectors, s.name) })}
            />
          ))}
        </div>
      </Section>

      {meta.sub_sectors?.length > 0 && (
        <Section title="Sub-sector" defaultOpen={false}>
          <div className="max-h-28 overflow-y-auto flex flex-wrap gap-1.5 pr-1">
            {meta.sub_sectors.map((s) => (
              <Chip
                key={s}
                label={s}
                active={filters.sub_sectors?.includes(s) ?? false}
                onToggle={() =>
                  onChange({ ...filters, sub_sectors: toggle(filters.sub_sectors, s) })
                }
              />
            ))}
          </div>
        </Section>
      )}

      <Section title="Stage">
        <div className="flex flex-wrap gap-1.5">
          {STAGES.map((s) => (
            <Chip
              key={s}
              label={s}
              active={filters.stages?.includes(s) ?? false}
              onToggle={() => onChange({ ...filters, stages: toggle(filters.stages, s) })}
            />
          ))}
        </div>
      </Section>

      <Section title="Business Model">
        <div className="flex flex-wrap gap-1.5">
          {MODELS.map((m) => (
            <Chip
              key={m}
              label={m}
              active={filters.business_models?.includes(m) ?? false}
              onToggle={() =>
                onChange({ ...filters, business_models: toggle(filters.business_models, m) })
              }
            />
          ))}
        </div>
      </Section>

      <Section title="Exit Status">
        <div className="flex flex-wrap gap-1.5">
          {EXIT.map((e) => (
            <Chip
              key={e}
              label={e}
              active={filters.exit_statuses?.includes(e) ?? false}
              onToggle={() =>
                onChange({ ...filters, exit_statuses: toggle(filters.exit_statuses, e) })
              }
            />
          ))}
        </div>
      </Section>

      <Section title="Tech-Enabled">
        <div className="flex gap-2">
          {[
            { label: 'Any', val: undefined },
            { label: 'Yes', val: true },
            { label: 'No', val: false },
          ].map((opt) => (
            <button
              key={String(opt.label)}
              onClick={() => onChange({ ...filters, tech_enabled: opt.val })}
              className={clsx(
                'flex-1 py-1.5 text-[11px] tracking-wide border transition-all duration-100',
                filters.tech_enabled === opt.val
                  ? 'border-gold text-gold'
                  : 'border-white/10 text-white/35 hover:border-white/25'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Section>

      {/* ── Geography ────────────────────────────────── */}

      {meta.regions?.length > 0 && (
        <Section title="Region" defaultOpen={false}>
          <div className="flex flex-wrap gap-1.5">
            {meta.regions.map((r) => (
              <Chip
                key={r}
                label={r}
                active={filters.regions?.includes(r) ?? false}
                onToggle={() => onChange({ ...filters, regions: toggle(filters.regions, r) })}
              />
            ))}
          </div>
        </Section>
      )}

      <Section title="Countries" defaultOpen={false}>
        <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
          {meta.countries.map((c) => (
            <label key={c} className="flex items-center gap-2.5 cursor-pointer group">
              <div
                className={clsx(
                  'w-3 h-3 border flex-shrink-0 transition-colors',
                  filters.countries?.includes(c)
                    ? 'border-gold bg-gold'
                    : 'border-white/20 group-hover:border-white/40'
                )}
              />
              <span className="text-[11px] text-white/35 group-hover:text-white/60 tracking-wide">
                {c}
              </span>
              <input
                type="checkbox"
                checked={filters.countries?.includes(c) ?? false}
                onChange={() =>
                  onChange({ ...filters, countries: toggle(filters.countries, c) })
                }
                className="sr-only"
              />
            </label>
          ))}
        </div>
      </Section>

      {/* ── Size ─────────────────────────────────────── */}

      <Section title="Employees" defaultOpen={false}>
        <RangeRow
          filters={filters}
          minKey="min_employees"
          maxKey="max_employees"
          placeholder={['0', 'any']}
          onChange={onChange}
        />
      </Section>

      <Section title="Founded Year" defaultOpen={false}>
        <RangeRow
          filters={filters}
          minKey="min_founded_year"
          maxKey="max_founded_year"
          placeholder={['2000', '2024']}
          onChange={onChange}
        />
      </Section>

      <Section title="Company Age (yrs)" defaultOpen={false}>
        <RangeRow
          filters={filters}
          minKey="min_age_years"
          maxKey="max_age_years"
          placeholder={['0', 'any']}
          step={0.5}
          onChange={onChange}
        />
      </Section>

      {/* ── Financial ────────────────────────────────── */}

      <Section title="Annual Revenue ($)" defaultOpen={false}>
        <RangeRow
          filters={filters}
          minKey="min_revenue_usd"
          maxKey="max_revenue_usd"
          placeholder={['0', 'any']}
          hint="USD"
          onChange={onChange}
        />
      </Section>

      <Section title="Revenue CAGR (%)" defaultOpen={false}>
        <RangeRow
          filters={filters}
          minKey="min_revenue_cagr"
          maxKey="max_revenue_cagr"
          placeholder={['-50', '200']}
          step={0.1}
          hint="3-year compound annual growth rate"
          onChange={onChange}
        />
      </Section>

      <Section title="EBITDA Margin (%)" defaultOpen={false}>
        <RangeRow
          filters={filters}
          minKey="min_ebitda_margin"
          maxKey="max_ebitda_margin"
          placeholder={['-100', '100']}
          step={0.1}
          hint="EBITDA as % of revenue"
          onChange={onChange}
        />
      </Section>

      {/* ── Market ───────────────────────────────────── */}

      <Section title="Market Size ($M TAM)" defaultOpen={false}>
        <RangeRow
          filters={filters}
          minKey="min_market_size_M"
          maxKey="max_market_size_M"
          placeholder={['0', 'any']}
          hint="Total addressable market in USD millions"
          onChange={onChange}
        />
      </Section>

      <Section title="Market Growth Rate (%)" defaultOpen={false}>
        <RangeRow
          filters={filters}
          minKey="min_market_growth_rate"
          maxKey="max_market_growth_rate"
          placeholder={['0', 'any']}
          step={0.1}
          hint="Annual market growth rate"
          onChange={onChange}
        />
      </Section>

      <Section title="Competition (0–10)" defaultOpen={false}>
        <RangeRow
          filters={filters}
          minKey="min_competition_intensity"
          maxKey="max_competition_intensity"
          placeholder={['0', '10']}
          step={0.1}
          hint="Lower = less competition"
          onChange={onChange}
        />
      </Section>

      {/* ── Risk & Quality ───────────────────────────── */}

      <Section title="Regulatory Stability (0–10)" defaultOpen={false}>
        <RangeRow
          filters={filters}
          minKey="min_regulatory_stability"
          maxKey="max_regulatory_stability"
          placeholder={['0', '10']}
          step={0.1}
          hint="Higher = more stable environment"
          onChange={onChange}
        />
      </Section>

      <Section title="ESG Score (0–10)" defaultOpen={false}>
        <RangeRow
          filters={filters}
          minKey="min_esg_score"
          maxKey="max_esg_score"
          placeholder={['0', '10']}
          step={0.1}
          hint="Environmental, Social & Governance"
          onChange={onChange}
        />
      </Section>
    </div>
  )
}
