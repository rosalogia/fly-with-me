import { PREF_LABELS, type CostPrefs } from '@fwm/shared'

export function PrefControls({
  prefs,
  onChange,
}: {
  prefs: CostPrefs
  onChange: (p: CostPrefs) => void
}) {
  const keys = Object.keys(PREF_LABELS) as (keyof CostPrefs)[]
  return (
    <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
      {keys.map((k) => (
        <label
          key={k}
          title={PREF_LABELS[k].hint}
          className="flex items-center gap-3 rounded border border-line bg-white px-3 py-2"
        >
          <span className="flex-1 text-sm">{PREF_LABELS[k].label}</span>
          <input
            type="number"
            min={0}
            step={k === 'fairnessPerDollar' ? 0.1 : 5}
            value={prefs[k]}
            onChange={(e) => onChange({ ...prefs, [k]: Math.max(0, Number(e.target.value)) })}
            className="w-24 rounded border border-line px-2 py-1 text-right font-mono text-sm focus:outline-2 focus:outline-jade"
            aria-label={PREF_LABELS[k].label}
          />
        </label>
      ))}
    </div>
  )
}
