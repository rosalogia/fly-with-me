import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { TripConfig } from '@fwm/shared'
import { globalApi } from '../api/client.js'

const summary = (c: TripConfig) =>
  `${c.parties.map((p) => p.origins[0]).join(' + ')} → ${c.intoChina.join('/')}, back from ${c.outOfChina.join('/')} · ${c.dateRange.start} – ${c.dateRange.end}`

export function HomePage() {
  const trips = useQuery({ queryKey: ['trips'], queryFn: globalApi.listTrips })
  const snapshots = useQuery({ queryKey: ['snapshots'], queryFn: globalApi.listSnapshots })
  const [name, setName] = useState('')
  const [startFrom, setStartFrom] = useState<string>('blank')

  const create = useMutation({
    mutationFn: () =>
      globalApi.createTrip({
        name: name.trim() || 'Untitled search',
        ...(startFrom !== 'blank' ? { cloneFrom: startFrom } : {}),
      }),
    onSuccess: (trip) => {
      window.location.href = `/t/${trip.id}?tab=setup`
    },
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="space-y-3 rounded border border-line bg-white p-5">
        <h2 className="text-lg font-semibold">Start a search</h2>
        <p className="text-sm text-ink-soft">
          A search is a group trip: who flies from where, into and out of which airports, in what
          date window. Every search gets its own link you can share and come back to.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="w-64 rounded border border-line bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-jade"
            placeholder="name it (e.g. “China, October”)…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create.mutate()}
          />
          <select
            className="rounded border border-line bg-white px-2 py-2 text-sm"
            value={startFrom}
            onChange={(e) => setStartFrom(e.target.value)}
            title="Start from a template or copy an existing search's setup"
          >
            <option value="blank">start fresh</option>
            {(trips.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                copy “{t.name}”
              </option>
            ))}
          </select>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="rounded bg-jade px-4 py-2 font-mono text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create search'}
          </button>
        </div>
        {create.isError && <p className="text-sm text-amber">Failed: {String(create.error)}</p>}
      </section>

      <section className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">Searches</h2>
        {trips.isLoading && <p className="text-sm text-ink-soft">Loading…</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {(trips.data ?? []).map((t) => (
            <a
              key={t.id}
              href={`/t/${t.id}`}
              className="block rounded border border-line bg-white p-4 hover:border-jade"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{t.name}</span>
                {t.id === 'main' && (
                  <span className="rounded-sm bg-jade-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-jade">
                    the group's
                  </span>
                )}
              </div>
              <div className="pt-1 text-xs text-ink-soft">{summary(t.config)}</div>
              <div className="pt-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                updated {new Date(t.updatedAt).toLocaleDateString()} · /t/{t.id}
              </div>
            </a>
          ))}
        </div>
      </section>

      {(snapshots.data ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
            Shared snapshots (frozen results)
          </h2>
          <ul className="space-y-1">
            {snapshots.data!.map((s) => (
              <li key={s.id} className="text-sm">
                <a href={s.url} className="text-jade underline">
                  {s.name}
                </a>{' '}
                <span className="font-mono text-xs text-ink-faint">
                  · {s.optionCount} options · {new Date(s.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
