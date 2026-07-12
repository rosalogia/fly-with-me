import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { costAll, pickSoloBest, type CostPrefs, type ScoredOptionDto } from '@fwm/shared'
import { globalApi } from '../api/client.js'
import { OptionDrawer } from '../components/OptionDrawer.js'
import { ResultsTable, type SortKey } from '../components/ResultsTable.js'
import { PrefControls } from '../components/WeightControls.js'
import { ViewerSelect, useViewer } from '../lib/viewer.jsx'
import { youPay } from '../lib/you.js'
import { AboutContent } from './AboutPage.js'

export function SnapshotPage({ id }: { id: string }) {
  const snap = useQuery({ queryKey: ['snapshot', id], queryFn: () => globalApi.getSnapshot(id) })
  const [prefs, setPrefs] = useState<CostPrefs | null>(null)
  const [sort, setSort] = useState<SortKey>('cost')
  const [selected, setSelected] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const { viewer } = useViewer()

  // Loading a shared setup creates a NEW search — it never overwrites anyone's.
  const useConfig = useMutation({
    mutationFn: () =>
      globalApi.createTrip({ name: `${snap.data!.name} (from snapshot)`, config: snap.data!.config }),
    onSuccess: (trip) => {
      window.location.href = `/t/${trip.id}?tab=setup`
    },
  })

  const effectivePrefs = prefs ?? snap.data?.prefs ?? null

  const options: ScoredOptionDto[] = useMemo(() => {
    if (!snap.data || !effectivePrefs) return []
    // Frozen options carry their metrics, so knobs still re-price locally.
    const results = costAll(snap.data.options, effectivePrefs)
    const rescored = snap.data.options.map((o, i) => ({ ...o, ...results[i]! }))
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
  }, [snap.data, effectivePrefs, sort, viewer])

  if (snap.isLoading) return <p className="text-ink-soft">Loading snapshot…</p>
  if (snap.isError || !snap.data) {
    return (
      <div className="space-y-2">
        <p className="text-amber">This snapshot doesn't exist (or was deleted).</p>
        <a href="/" className="text-sm text-jade underline">
          Go to the live app
        </a>
      </div>
    )
  }

  const s = snap.data
  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded border border-line bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{s.name}</h2>
          <span className="font-mono text-xs text-ink-faint">
            saved {new Date(s.createdAt).toLocaleString()} · {s.optionCount} options
            {s.provider !== 'duffel' ? ` · ${s.provider} data` : ''}
          </span>
        </div>
        <p className="text-sm text-ink-soft">
          {s.optionCount > 0
            ? 'A frozen picture of the search at the moment it was saved — fares move, so re-run a live search before booking anything.'
            : 'A shared trip setup (no results attached) — load it into your app and run your own search for current fares.'}
        </p>
        {s.optionCount > 0 && <ViewerSelect parties={s.config.parties.map((p) => p.id)} tone="light" />}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
            className="rounded bg-board px-3 py-1.5 font-mono text-sm text-white hover:bg-ink"
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button
            onClick={() => useConfig.mutate()}
            disabled={useConfig.isPending}
            className="rounded border border-line bg-white px-3 py-1.5 font-mono text-sm hover:bg-chart disabled:opacity-50"
            title="Copy this setup into a brand-new search of your own — nobody else's search is touched"
          >
            {useConfig.isPending ? 'Creating…' : 'Open as a new search'}
          </button>
          <a href="/" className="rounded border border-line bg-white px-3 py-1.5 font-mono text-sm hover:bg-chart">
            All searches
          </a>
        </div>
        {useConfig.isError && <p className="text-xs text-amber">Failed: {String(useConfig.error)}</p>}
      </section>

      {s.optionCount === 0 ? (
        <section className="space-y-2 rounded border border-line bg-white p-4">
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">The setup</h3>
          <ul className="space-y-1 text-sm text-ink-soft">
            {s.config.parties.map((p) => (
              <li key={p.id}>
                <span className="font-mono font-semibold text-ink">{p.id}</span> — {p.travelers}{' '}
                traveler{p.travelers === 1 ? '' : 's'} from {p.origins.join(', ')}
              </li>
            ))}
            <li>
              Into <span className="font-mono">{s.config.intoChina.join(', ')}</span>, out of{' '}
              <span className="font-mono">{s.config.outOfChina.join(', ')}</span>
            </li>
            <li>
              Departures {s.config.dateRange.start} – {s.config.dateRange.end}, leaving after{' '}
              {s.config.departAfterLocal}, {s.config.tripLenDays.join('/')} days
            </li>
          </ul>
        </section>
      ) : (
        <>
          {effectivePrefs && (
            <details className="rounded border border-line bg-white px-3 py-2">
              <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-widest text-ink-faint">
                Re-price with your own dollar knobs (doesn't change the saved snapshot)
              </summary>
              <div className="pt-2">
                <PrefControls prefs={effectivePrefs} onChange={setPrefs} />
              </div>
            </details>
          )}

          <ResultsTable options={options} sort={sort} onSort={setSort} onSelect={setSelected} viewer={viewer} />
        </>
      )}

      <details className="rounded border border-line bg-white px-3 py-2">
        <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-widest text-ink-faint">
          New here? What the app does and what the terms mean
        </summary>
        <div className="pt-3">
          <AboutContent />
        </div>
      </details>

      {selected &&
        (() => {
          const sel = options.find((o) => o.id === selected) ?? null
          return (
            <OptionDrawer
              id={selected}
              scored={sel}
              frozen
              soloBest={
                effectivePrefs && sel
                  ? pickSoloBest(s.solo ?? [], effectivePrefs, {
                      depDate: sel.pairDepart,
                      retDate: sel.pairReturn,
                    })
                  : undefined
              }
              viewer={viewer}
              onClose={() => setSelected(null)}
            />
          )
        })()}
    </div>
  )
}
