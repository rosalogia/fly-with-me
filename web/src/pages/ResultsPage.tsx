import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_PREFS, costAll, pickSoloBest, prefsToParam, soloWeeks,
  type CostPrefs, type ScoredOptionDto,
} from '@fwm/shared'
import { OptionDrawer } from '../components/OptionDrawer.js'
import { ResultsTable, type SortKey } from '../components/ResultsTable.js'
import { PrefControls } from '../components/WeightControls.js'
import { durationHM, money, shortDate } from '../lib/format.js'
import { useTripApi } from '../lib/trip.jsx'
import { useViewer } from '../lib/viewer.jsx'
import { youPay } from '../lib/you.js'

const PRESETS: { label: string; hint: string; prefs: CostPrefs }[] = [
  {
    label: 'Balanced',
    hint: 'Time at $20/hr, split tickets cost $300 of peace of mind (default)',
    prefs: { ...DEFAULT_PREFS },
  },
  {
    label: 'Cheapest cash',
    hint: 'Mostly about the money — time is nearly free, risk tolerated',
    prefs: { ...DEFAULT_PREFS, hourlyDollars: 5, splitRiskDollars: 100, oddHoursDollars: 0 },
  },
  {
    label: 'Least hassle',
    hint: 'Time is precious ($60/hr) and self-transfers are strongly avoided',
    prefs: { ...DEFAULT_PREFS, hourlyDollars: 60, splitRiskDollars: 800, oddHoursDollars: 150 },
  },
  {
    label: 'Fairest',
    hint: 'Every $1 of per-person gap counts like $1 of cost (no settling up)',
    prefs: { ...DEFAULT_PREFS, fairnessPerDollar: 1 },
  },
]

interface SavedControls {
  prefs: CostPrefs
  activePreset: string | null
  showIncomplete: boolean
  gateways: 'all' | 'us' | 'nonus'
}

const CONTROLS_KEY = 'fwm-results-controls'

function loadControls(): SavedControls {
  try {
    const raw = localStorage.getItem(CONTROLS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SavedControls>
      return {
        prefs: { ...DEFAULT_PREFS, ...(parsed.prefs ?? {}) },
        activePreset: parsed.activePreset ?? null,
        showIncomplete: parsed.showIncomplete ?? false,
        gateways: parsed.gateways ?? 'all',
      }
    }
  } catch {
    /* corrupted storage — fall through to defaults */
  }
  return { prefs: DEFAULT_PREFS, activePreset: 'Balanced', showIncomplete: false, gateways: 'all' }
}

export function ResultsPage() {
  const initial = useMemo(loadControls, [])
  const [prefs, setPrefs] = useState<CostPrefs>(initial.prefs)
  const [activePreset, setActivePreset] = useState<string | null>(initial.activePreset)
  const [showIncomplete, setShowIncomplete] = useState(initial.showIncomplete)
  const [gateways, setGateways] = useState<'all' | 'us' | 'nonus'>(initial.gateways)
  const [sort, setSort] = useState<SortKey>('cost')
  const [selected, setSelected] = useState<string | null>(null)

  // Knobs and filters survive reloads — set them once per browser.
  useEffect(() => {
    localStorage.setItem(CONTROLS_KEY, JSON.stringify({ prefs, activePreset, showIncomplete, gateways }))
  }, [prefs, activePreset, showIncomplete, gateways])
  const { viewer } = useViewer()
  const api = useTripApi()

  const query = useQuery({ queryKey: ['options', api.tripId], queryFn: api.getOptions })
  const soloQuery = useQuery({ queryKey: ['solo', api.tripId], queryFn: api.getSolo })

  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const share = useMutation({
    mutationFn: () =>
      api.createSnapshot({
        prefs: prefsToParam(prefs),
        gateways: gateways === 'all' ? null : gateways,
        includeIncomplete: showIncomplete,
        top: 100,
      }),
    onSuccess: (meta) => {
      const url = `${window.location.origin}${meta.url}`
      setShareUrl(url)
      void navigator.clipboard.writeText(url).catch(() => {})
    },
  })

  // Client-side re-rank: cost math is pure and shared with the API, so knob
  // changes re-price instantly without refetching.
  const options: ScoredOptionDto[] = useMemo(() => {
    const all = query.data ?? []
    let visible = showIncomplete ? all : all.filter((o) => o.missingParties.length === 0)
    if (gateways === 'us') visible = visible.filter((o) => o.gatewayOutUS && o.gatewayInUS)
    if (gateways === 'nonus') visible = visible.filter((o) => !(o.gatewayOutUS && o.gatewayInUS))
    const results = costAll(visible, prefs)
    const rescored = visible.map((o, i) => ({ ...o, ...results[i]! }))
    const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) => {
      if (a == null && b == null) return 0
      if (a == null) return 1
      if (b == null) return -1
      return (a - b) * dir
    }
    const cmp: Record<SortKey, (a: ScoredOptionDto, b: ScoredOptionDto) => number> = {
      cost: (a, b) => nullsLast(a.trueCostCents, b.trueCostCents, 1),
      cash: (a, b) => nullsLast(a.cashCents, b.cashCents, 1),
      per_person_max: (a, b) => nullsLast(a.perPersonMaxCents, b.perPersonMaxCents, 1),
      fairness: (a, b) => nullsLast(a.metrics?.fairness ?? null, b.metrics?.fairness ?? null, 1),
      duration: (a, b) => nullsLast(a.metrics?.trunk_duration ?? null, b.metrics?.trunk_duration ?? null, 1),
      total_time: (a, b) =>
        nullsLast(a.metrics?.total_travel_time ?? null, b.metrics?.total_travel_time ?? null, 1),
      you: (a, b) =>
        viewer
          ? nullsLast(youPay(a, viewer).cents, youPay(b, viewer).cents, 1)
          : nullsLast(a.perPersonMaxCents, b.perPersonMaxCents, 1),
    }
    return rescored.sort(cmp[sort])
  }, [query.data, prefs, showIncomplete, gateways, sort, viewer])

  // Solo comparisons are pinned to the dates of the option they're compared with.
  const selectedOption = selected ? options.find((o) => o.id === selected) ?? null : null
  const soloBestForSelected = useMemo(
    () =>
      selectedOption
        ? pickSoloBest(soloQuery.data ?? [], prefs, {
            depDate: selectedOption.pairDepart,
            retDate: selectedOption.pairReturn,
          })
        : new Map<string, never>(),
    [soloQuery.data, prefs, selectedOption],
  )

  const benchOption = options.find((o) => o.benchmark) ?? null
  const soloBestForBench = useMemo(
    () =>
      benchOption
        ? pickSoloBest(soloQuery.data ?? [], prefs, {
            depDate: benchOption.pairDepart,
            retDate: benchOption.pairReturn,
          })
        : new Map<string, never>(),
    [soloQuery.data, prefs, benchOption],
  )

  const picks = useMemo(() => {
    const priced = options.filter((o) => o.breakdown)
    if (priced.length === 0) return []
    const by = (f: (o: ScoredOptionDto) => number) => [...priced].sort((a, b) => f(a) - f(b))[0]!
    const cheapest = by((o) => o.cashCents!)
    const fastest = by((o) => o.metrics!.total_travel_time)
    const fairest = by((o) => o.metrics!.fairness)
    return [
      {
        label: 'Cheapest cash',
        o: cheapest,
        value: money(cheapest.cashCents!),
      },
      { label: 'Least travel', o: fastest, value: `${durationHM(fastest.metrics!.total_travel_time)} avg` },
      { label: 'Fairest', o: fairest, value: `${money(fairest.metrics!.fairness)} spread` },
    ]
  }, [options])

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
              What matters most?
            </span>
            <div className="flex rounded border border-line bg-white p-0.5 font-mono text-xs">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  title={p.hint}
                  onClick={() => {
                    setPrefs(p.prefs)
                    setActivePreset(p.label)
                  }}
                  className={`rounded px-2 py-1 uppercase tracking-wider ${
                    activePreset === p.label ? 'bg-jade text-white' : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex rounded border border-line bg-white p-0.5 font-mono text-xs">
              {(
                [
                  ['all', 'All gateways', 'Everything'],
                  ['us', 'Meet in US', 'The whole group boards the shared flight at a US airport'],
                  ['nonus', 'Meet abroad', 'The group converges at a foreign hub (Istanbul, Munich, Vancouver…)'],
                ] as const
              ).map(([key, label, hint]) => (
                <button
                  key={key}
                  title={hint}
                  onClick={() => setGateways(key)}
                  className={`rounded px-2 py-1 uppercase tracking-wider ${
                    gateways === key ? 'bg-board text-white' : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label
              className="flex items-center gap-2 text-sm text-ink-soft"
              title="Also show combinations where some travelers have no priced route yet — you can price a split ticket from the detail view"
            >
              <input
                type="checkbox"
                checked={showIncomplete}
                onChange={(e) => setShowIncomplete(e.target.checked)}
                className="accent-jade"
              />
              show unpriced combos
            </label>
          </div>
        </div>
        <details className="rounded border border-line bg-white px-3 py-2">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-widest text-ink-faint">
            Fine-tune (everything is in dollars — “true cost” = tickets + what your time, risk and comfort are worth)
          </summary>
          <div className="pt-2">
            <PrefControls
              prefs={prefs}
              onChange={(p) => {
                setPrefs(p)
                setActivePreset(null)
              }}
            />
          </div>
        </details>
      </section>

      {picks.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {picks.map((p) => (
            <button
              key={p.label}
              onClick={() => setSelected(p.o.id)}
              className="rounded border border-line bg-white p-3 text-left hover:border-jade"
            >
              <div className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">{p.label}</div>
              <div className="font-mono text-lg font-semibold">{p.value}</div>
              <div className="text-xs text-ink-soft">
                {shortDate(p.o.pairDepart)} → {shortDate(p.o.pairReturn)} · via {p.o.gatewayOut}
                {p.o.splitParties.length > 0 ? ` · 2 tickets for ${p.o.splitParties.join(', ')}` : ''}
              </div>
            </button>
          ))}
          {benchOption != null &&
            soloBestForBench.size > 0 &&
            (() => {
              const parties = [...soloBestForBench.values()]
              const soloTotal = parties.reduce((s, c) => s + c.perPersonCents * c.travelers, 0)
              const benchCash = benchOption.cashCents
              return (
                <div
                  className="rounded border border-dashed border-line bg-chart/60 p-3"
                  title={parties
                    .map((c) => `${c.partyId}: ${money(c.perPersonCents)}/person · ${durationHM(c.doorMin)}`)
                    .join('\n')}
                >
                  <div className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
                    If everyone flew alone
                  </div>
                  <div className="font-mono text-lg font-semibold">{money(soloTotal)}</div>
                  <div className="text-xs text-ink-soft">
                    same dates as the benchmark ({shortDate(benchOption.pairDepart)} →{' '}
                    {shortDate(benchOption.pairReturn)}), separate flights
                    {benchCash != null &&
                      ` — being together costs ${benchCash - soloTotal >= 0 ? '+' : '−'}${money(Math.abs(benchCash - soloTotal))}`}
                  </div>
                </div>
              )
            })()}
        </section>
      )}

      {(soloQuery.data ?? []).length > 0 &&
        (() => {
          const allParties = [...new Set(soloQuery.data!.map((c) => c.partyId))].sort()
          const weeks = soloWeeks(soloQuery.data!, prefs).filter(
            (w) => w.coveredParties.length === allParties.length,
          )
          if (weeks.length === 0) return null
          const bestGc = weeks[0]!.totalGcCents
          return (
            <details className="rounded border border-line bg-white px-3 py-2">
              <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-widest text-ink-faint">
                Flying separately instead — which dates are best? ({weeks.length} viable weeks)
              </summary>
              <div className="overflow-x-auto pt-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                      <th className="px-2 py-1 font-medium">Dates</th>
                      <th className="px-2 py-1 text-right font-medium" title="All tickets, everyone, no shared flights">
                        Total cash
                      </th>
                      <th className="px-2 py-1 text-right font-medium" title="Traveler-weighted average, home to home">
                        Avg door-to-door
                      </th>
                      <th className="px-2 py-1 text-right font-medium">Per person</th>
                      <th className="px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.map((w, i) => (
                      <tr key={`${w.depDate}${w.retDate}`} className="border-t border-line/60">
                        <td className="whitespace-nowrap px-2 py-1.5 text-ink-soft">
                          {shortDate(w.depDate)} → {shortDate(w.retDate)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-semibold">
                          {money(w.totalCashCents)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-ink-soft">
                          {durationHM(w.travelerWeightedDoorMin)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-xs text-ink-soft">
                          {allParties
                            .map((p) => `${p} ${money(w.best[p]!.perPersonCents)}`)
                            .join(' · ')}
                        </td>
                        <td className="px-2 py-1.5">
                          {w.totalGcCents === bestGc && (
                            <span className="rounded-sm bg-jade-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-jade">
                              best dates
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="pt-2 text-[11px] text-ink-faint">
                  Everyone books their own best flights for those dates — nobody travels together.
                  Ranked by your dollar knobs (price + time + comfort); open any group option's
                  details to see the same-dates comparison per person.
                </p>
              </div>
            </details>
          )
        })()}

      <div className="flex flex-wrap items-baseline gap-3 font-mono text-xs text-ink-soft">
        {query.isLoading && <span>Loading options…</span>}
        {query.isError && <span className="text-amber">Failed to load: {String(query.error)}</span>}
        {query.data && (
          <>
            <span>
              {options.length} option{options.length === 1 ? '' : 's'}
            </span>
            <span className="text-jade" title="Nothing else is cheaper AND faster AND fairer (cash, person-hours and spread)">
              {options.filter((o) => o.pareto).length} marked “best”
            </span>
            <button
              onClick={() => share.mutate()}
              disabled={share.isPending || options.length === 0}
              title="Freeze this view (top 100 options, your knobs and filters) at a link you can send to the group"
              className="ml-auto rounded bg-board px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-white hover:bg-ink disabled:opacity-50"
            >
              {share.isPending ? 'Saving…' : 'Share these results'}
            </button>
            {shareUrl && (
              <span className="text-jade">
                copied: <a className="underline" href={shareUrl}>{shareUrl}</a>
              </span>
            )}
            {share.isError && <span className="text-amber">share failed: {String(share.error)}</span>}
          </>
        )}
      </div>

      <ResultsTable options={options} sort={sort} onSort={setSort} onSelect={setSelected} viewer={viewer} />

      {selected && (
        <OptionDrawer
          id={selected}
          scored={selectedOption}
          soloBest={soloBestForSelected}
          viewer={viewer}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
