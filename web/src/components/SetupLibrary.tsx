import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { TripConfig } from '@fwm/shared'
import { globalApi } from '../api/client.js'
import { useTripApi } from '../lib/trip.jsx'

const configSummary = (c: TripConfig) =>
  `${c.intoChina.join('/')} → ${c.outOfChina.join('/')} · ${c.dateRange.start}–${c.dateRange.end} · ${c.parties
    .map((p) => p.id)
    .join(',')}`

/**
 * Per-trip housekeeping: rename, duplicate into a new search, and the automatic
 * history of overwritten setups. Duplicates share the provider cache, so
 * experimenting in a copy is cheap and can never disturb this search.
 */
export function TripTools() {
  const qc = useQueryClient()
  const api = useTripApi()
  const trip = useQuery({ queryKey: ['trip', api.tripId], queryFn: () => globalApi.getTrip(api.tripId) })
  const history = useQuery({ queryKey: ['history', api.tripId], queryFn: api.getHistory })
  const [newName, setNewName] = useState('')

  const rename = useMutation({
    mutationFn: (name: string) => globalApi.renameTrip(api.tripId, name),
    onSuccess: () => {
      setNewName('')
      void qc.invalidateQueries({ queryKey: ['trip', api.tripId] })
      void qc.invalidateQueries({ queryKey: ['trips'] })
    },
  })

  const duplicate = useMutation({
    mutationFn: () =>
      globalApi.createTrip({ name: `${trip.data?.name ?? 'search'} (copy)`, cloneFrom: api.tripId }),
    onSuccess: (t) => {
      window.location.href = `/t/${t.id}?tab=setup`
    },
  })

  const restore = useMutation({
    mutationFn: api.restoreHistory,
    onSuccess: () => {
      for (const key of ['config', 'date-pairs', 'options', 'stats', 'history', 'solo']) {
        void qc.invalidateQueries({ queryKey: [key, api.tripId] })
      }
      void qc.invalidateQueries({ queryKey: ['trip', api.tripId] })
    },
  })

  return (
    <section className="space-y-3 rounded border border-line bg-white p-4">
      <h2 className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
        This search
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="w-64 rounded border border-line bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-jade"
          placeholder={trip.data ? `rename “${trip.data.name}”…` : 'rename…'}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newName.trim() && rename.mutate(newName)}
        />
        <button
          onClick={() => rename.mutate(newName)}
          disabled={!newName.trim() || rename.isPending}
          className="rounded border border-line bg-white px-3 py-1.5 font-mono text-sm hover:bg-chart disabled:opacity-50"
        >
          Rename
        </button>
        <button
          onClick={() => duplicate.mutate()}
          disabled={duplicate.isPending}
          title="Copy this setup into a new search — experiment there without touching this one; cached fares are shared"
          className="rounded bg-board px-3 py-1.5 font-mono text-sm text-white hover:bg-ink disabled:opacity-50"
        >
          {duplicate.isPending ? 'Duplicating…' : 'Duplicate as new search'}
        </button>
        <a href="/" className="font-mono text-xs text-ink-soft underline">
          all searches
        </a>
      </div>

      {(history.data ?? []).length > 0 && (
        <details>
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-widest text-ink-faint">
            History — every overwritten setup, restorable ({history.data!.length})
          </summary>
          <ul className="space-y-1 pt-2">
            {history.data!.map((h) => (
              <li key={h.id} className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => restore.mutate(h.id)}
                  disabled={restore.isPending}
                  className="rounded border border-line bg-white px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider hover:bg-chart disabled:opacity-50"
                >
                  restore
                </button>
                <span className="text-ink-soft">{configSummary(h.config)}</span>
                <span className="ml-auto font-mono text-xs text-ink-faint">
                  {new Date(h.savedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
