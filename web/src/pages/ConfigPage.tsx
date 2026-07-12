import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { TripConfig } from '@fwm/shared'
import { AirportInput } from '../components/AirportInput.js'
import { RefreshBar } from '../components/RefreshBar.js'
import { TripTools } from '../components/SetupLibrary.js'
import { useTripApi } from '../lib/trip.jsx'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Deliberately a div, not a <label>: a label forwards clicks to its first
// labelable descendant, which for chip inputs is the first chip's remove
// button — one click would remove two chips.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block space-y-1">
      <span className="block font-mono text-[11px] uppercase tracking-widest text-ink-faint">{label}</span>
      {children}
    </div>
  )
}

const inputCls =
  'w-full rounded border border-line bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-jade'

const csv = (xs: string[]) => xs.join(', ')
const parseCsv = (s: string) =>
  s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)

/**
 * Comma-separated list input. Keeps the raw text while focused (so commas and
 * partial entries aren't eaten by normalization on every keystroke) and commits
 * the parsed list on each change; snaps to canonical form on blur.
 */
function CsvInput({
  value,
  onCommit,
  placeholder,
}: {
  value: string[]
  onCommit: (v: string[]) => void
  placeholder?: string
}) {
  const [text, setText] = useState(csv(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(csv(value))
  }, [value, focused])
  return (
    <input
      className={inputCls}
      value={text}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        setText(csv(value))
      }}
      onChange={(e) => {
        setText(e.target.value)
        onCommit(parseCsv(e.target.value))
      }}
    />
  )
}

export function ConfigPage() {
  const qc = useQueryClient()
  const api = useTripApi()
  const remote = useQuery({ queryKey: ['config', api.tripId], queryFn: api.getConfig })
  const [cfg, setCfg] = useState<TripConfig | null>(null)
  // Re-sync the form whenever the server config changes (saves, variant
  // switches, history restores). Refetch-on-focus is off, so this never
  // clobbers in-progress edits out of the blue.
  useEffect(() => {
    if (remote.data) setCfg(remote.data)
  }, [remote.data])

  const pairs = useQuery({ queryKey: ['date-pairs', api.tripId], queryFn: api.getDatePairs })

  const invalidate = () => {
    for (const key of ['config', 'date-pairs', 'options', 'stats', 'solo', 'history']) {
      void qc.invalidateQueries({ queryKey: [key, api.tripId] })
    }
    void qc.invalidateQueries({ queryKey: ['trip', api.tripId] })
    void qc.invalidateQueries({ queryKey: ['trips'] })
  }

  const save = useMutation({
    mutationFn: (c: TripConfig) => api.putConfig(c),
    onSuccess: (saved) => {
      setCfg(saved)
      invalidate()
    },
  })

  const [setupUrl, setSetupUrl] = useState<string | null>(null)
  const shareSetup = useMutation({
    // Save first so the link can never capture a config older than what's on screen.
    mutationFn: async (c: TripConfig) => {
      await api.putConfig(c)
      return api.createSnapshot({ name: `Trip setup — ${c.intoChina[0]} → ${c.outOfChina[0]}`, top: 0 })
    },
    onSuccess: (meta) => {
      const url = `${window.location.origin}${meta.url}`
      setSetupUrl(url)
      void navigator.clipboard.writeText(url).catch(() => {})
      invalidate()
    },
  })

  if (!cfg) return <p className="text-ink-soft">Loading config…</p>

  const set = (patch: Partial<TripConfig>) => setCfg({ ...cfg, ...patch })
  const isDirty = remote.data != null && JSON.stringify(cfg) !== JSON.stringify(remote.data)

  return (
    <div className="max-w-3xl space-y-6">
      <section className="space-y-3">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">Parties</h2>
        {cfg.parties.map((p, i) => (
          <div key={i} className="flex items-end gap-3">
            <Field label="Name">
              <input
                className={inputCls}
                value={p.id}
                onChange={(e) => {
                  const parties = [...cfg.parties]
                  parties[i] = { ...p, id: e.target.value }
                  set({ parties })
                }}
              />
            </Field>
            <Field label="Flies from">
              <AirportInput
                value={p.origins}
                onChange={(origins) => {
                  const parties = [...cfg.parties]
                  parties[i] = { ...p, origins }
                  set({ parties })
                }}
              />
            </Field>
            <Field label="Travelers">
              <input
                type="number"
                min={1}
                className={`${inputCls} w-20`}
                value={p.travelers}
                onChange={(e) => {
                  const parties = [...cfg.parties]
                  parties[i] = { ...p, travelers: Number(e.target.value) }
                  set({ parties })
                }}
              />
            </Field>
            <button
              onClick={() => set({ parties: cfg.parties.filter((_, j) => j !== i) })}
              className="mb-1 rounded border border-line bg-white px-2 py-1 text-sm text-ink-soft hover:bg-chart"
              aria-label={`Remove party ${p.id}`}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={() => set({ parties: [...cfg.parties, { id: `P${cfg.parties.length + 1}`, origins: ['JFK'], travelers: 1 }] })}
          className="rounded border border-line bg-white px-3 py-1 text-sm hover:bg-chart"
        >
          Add party
        </button>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Into (arrival airports)">
          <AirportInput value={cfg.intoChina} onChange={(intoChina) => set({ intoChina })} />
        </Field>
        <Field label="Out of (return departure airports)">
          <AirportInput value={cfg.outOfChina} onChange={(outOfChina) => set({ outOfChina })} />
        </Field>
        <Field label="Earliest departure date">
          <input type="date" className={inputCls} value={cfg.dateRange.start} onChange={(e) => set({ dateRange: { ...cfg.dateRange, start: e.target.value } })} />
        </Field>
        <Field label="Latest departure date">
          <input type="date" className={inputCls} value={cfg.dateRange.end} onChange={(e) => set({ dateRange: { ...cfg.dateRange, end: e.target.value } })} />
        </Field>
        <Field label="Departure day of week">
          <select className={inputCls} value={cfg.departDow} onChange={(e) => set({ departDow: Number(e.target.value) })}>
            {DOW.map((d, i) => (
              <option key={i} value={i}>{d}</option>
            ))}
          </select>
        </Field>
        <Field label="Leave home after (local)">
          <input className={inputCls} value={cfg.departAfterLocal} onChange={(e) => set({ departAfterLocal: e.target.value })} />
        </Field>
        <Field label="Return days of week">
          <div className="flex gap-2 pt-1">
            {DOW.map((d, i) => (
              <label key={i} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  className="accent-jade"
                  checked={cfg.returnDow.includes(i)}
                  onChange={(e) =>
                    set({ returnDow: e.target.checked ? [...cfg.returnDow, i] : cfg.returnDow.filter((x) => x !== i) })
                  }
                />
                {d}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Trip lengths (days, comma-separated)">
          <CsvInput
            value={cfg.tripLenDays.map(String)}
            onCommit={(xs) => set({ tripLenDays: xs.map(Number).filter((n) => Number.isInteger(n) && n > 0) })}
          />
        </Field>
        <Field label="Max connections per direction">
          <input type="number" min={0} max={2} className={inputCls} value={cfg.maxConnections} onChange={(e) => set({ maxConnections: Number(e.target.value) })} />
        </Field>
        <Field label="Min self-transfer buffer (minutes)">
          <input type="number" min={0} className={inputCls} value={cfg.minSelfTransferMin} onChange={(e) => set({ minSelfTransferMin: Number(e.target.value) })} />
        </Field>
        <Field label="Only meet at these gateways (empty = anywhere)">
          <AirportInput
            value={cfg.gatewayAllowlist ?? []}
            onChange={(xs) => set({ gatewayAllowlist: xs.length === 0 ? null : xs })}
            placeholder="anywhere"
          />
        </Field>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => save.mutate(cfg)}
          disabled={save.isPending}
          className="rounded bg-board px-4 py-2 font-mono text-sm text-white hover:bg-ink disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save trip setup'}
        </button>
        {isDirty && !save.isPending && (
          <span className="font-mono text-xs text-amber">unsaved changes</span>
        )}
        <button
          onClick={() => shareSetup.mutate(cfg)}
          disabled={shareSetup.isPending}
          title="Saves the setup, then freezes it at a link — recipients load it into their app and run their own search"
          className="rounded border border-line bg-white px-4 py-2 font-mono text-sm hover:bg-chart disabled:opacity-50"
        >
          {shareSetup.isPending ? 'Creating link…' : 'Share this setup as a link'}
        </button>
        {save.isError && <span className="text-sm text-amber">Save failed: {String(save.error)}</span>}
        {shareSetup.isError && <span className="text-sm text-amber">Share failed: {String(shareSetup.error)}</span>}
        {save.isSuccess && !save.isPending && !setupUrl && <span className="text-sm text-jade">Saved.</span>}
        {setupUrl && (
          <span className="font-mono text-xs text-jade">
            copied: <a className="underline" href={setupUrl}>{setupUrl}</a>
          </span>
        )}
      </div>

      <section className="space-y-2 rounded border border-line bg-white p-4">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
          Candidate date pairs ({pairs.data?.length ?? '…'})
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {(pairs.data ?? []).map((p) => (
            <span key={`${p.depart}${p.ret}`} className="rounded-sm bg-chart px-2 py-0.5 font-mono text-xs">
              {p.depart} → {p.ret}
            </span>
          ))}
        </div>
      </section>

      <TripTools />

      <RefreshBar draft={cfg} isDirty={isDirty} />
    </div>
  )
}
