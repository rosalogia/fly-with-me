import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { TripConfig } from '@fwm/shared'
import { globalApi } from '../api/client.js'
import { useTripApi } from '../lib/trip.jsx'

export function RefreshBar({
  draft,
  isDirty,
}: {
  /** The setup form's current (possibly unsaved) state. */
  draft: TripConfig | null
  isDirty: boolean
}) {
  const qc = useQueryClient()
  const api = useTripApi()
  const [force, setForce] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)

  // Cost preview computed from the FORM state, so editing the setup immediately
  // shows what a refresh would actually fetch — before anything is saved.
  const preview = useQuery({
    queryKey: ['refresh-preview', api.tripId, draft ? JSON.stringify(draft) : 'saved'],
    queryFn: () => api.refreshPreview(isDirty && draft ? draft : undefined),
    placeholderData: (prev) => prev,
  })

  const start = useMutation({
    // Refresh always searches the SAVED config — so when the form has unsaved
    // edits, save them first. One button, no silent mismatch.
    mutationFn: async () => {
      if (isDirty && draft) {
        await api.putConfig(draft)
        for (const key of ['config', 'date-pairs', 'options', 'stats', 'solo', 'history']) {
          void qc.invalidateQueries({ queryKey: [key, api.tripId] })
        }
        void qc.invalidateQueries({ queryKey: ['trip', api.tripId] })
      }
      return api.startRefresh(force)
    },
    onSuccess: (job) => setJobId(job.id),
  })

  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => globalApi.getJob(jobId!),
    enabled: jobId != null,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 800 : false),
  })

  const status = job.data?.status
  useEffect(() => {
    if (status === 'done' || status === 'error') {
      // Refresh finished — pull new options/stats.
      void qc.invalidateQueries({ queryKey: ['options', api.tripId] })
      void qc.invalidateQueries({ queryKey: ['solo', api.tripId] })
      void qc.invalidateQueries({ queryKey: ['stats', api.tripId] })
      void qc.invalidateQueries({ queryKey: ['refresh-preview', api.tripId] })
    }
  }, [status, qc, api.tripId])

  const p = preview.data
  const toFetch = p ? p.estimatedFullRefreshQueries - p.cachedQueries : null
  const allCachedNoop =
    job.data?.status === 'done' &&
    job.data.errors.length === 0 &&
    job.data.skippedCacheHits === job.data.total

  return (
    <section className="space-y-3 rounded border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">Flight data</h2>
        {p && (
          <span className="font-mono text-xs text-ink-soft">
            {isDirty && <span className="text-amber">this (unsaved) setup </span>}
            ≈ {p.estimatedFullRefreshQueries} searches ·{' '}
            <span className={toFetch === 0 ? 'text-jade' : ''}>{p.cachedQueries} already cached</span>
            {toFetch === 0 ? ' — results are ready now' : ` — refresh fetches ${toFetch}`}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={() => start.mutate()}
          disabled={job.data?.status === 'running' || start.isPending}
          className={`rounded px-4 py-2 font-mono text-sm text-white hover:opacity-90 disabled:opacity-50 ${
            isDirty ? 'bg-amber' : 'bg-jade'
          }`}
          title={
            isDirty
              ? 'Your setup edits are not saved yet — this saves them, then searches for the new setup'
              : 'Search flights for the saved setup (cached queries are free)'
          }
        >
          {job.data?.status === 'running' || start.isPending
            ? 'Searching…'
            : isDirty
              ? 'Save setup & refresh'
              : 'Refresh flight data'}
        </button>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="accent-jade" />
          re-fetch cached queries (for current prices)
        </label>
        {start.isError && <span className="text-sm text-amber">Failed: {String(start.error)}</span>}
      </div>
      {job.data && (
        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-chart">
            <div
              className="h-full bg-jade transition-all"
              style={{ width: `${job.data.total ? (100 * job.data.done) / job.data.total : 0}%` }}
            />
          </div>
          <div className="font-mono text-xs text-ink-soft">
            {job.data.done}/{job.data.total} searches · {job.data.skippedCacheHits} cache hits ·{' '}
            {job.data.errors.length} errors {job.data.status !== 'running' && `· ${job.data.status}`}
          </div>
          {allCachedNoop && (
            <p className="text-xs text-ink-soft">
              Everything was already cached, so the results didn't change. To search different
              flights, edit the setup above — the counter shows how many new searches your edits
              need. To re-check current prices for this same setup, tick “re-fetch cached queries”.
            </p>
          )}
          {job.data.errors.length > 0 && (
            <details className="text-xs text-amber">
              <summary>errors</summary>
              <ul className="list-inside list-disc">
                {job.data.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}
