import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { globalApi } from '../api/client.js'
import { useTripApi } from '../lib/trip.jsx'

export function RefreshBar() {
  const qc = useQueryClient()
  const api = useTripApi()
  const [force, setForce] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)

  const start = useMutation({
    mutationFn: () => api.startRefresh(force),
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
    }
  }, [status, qc, api.tripId])

  const stats = useQuery({ queryKey: ['stats', api.tripId], queryFn: api.getStats })

  return (
    <section className="space-y-3 rounded border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">Flight data</h2>
        {stats.data && (
          <span className="font-mono text-xs text-ink-soft">
            this setup ≈ {stats.data.estimatedFullRefreshQueries} searches ·{' '}
            <span className={stats.data.cachedQueries === stats.data.estimatedFullRefreshQueries ? 'text-jade' : ''}>
              {stats.data.cachedQueries} already cached
            </span>
            {stats.data.cachedQueries === stats.data.estimatedFullRefreshQueries
              ? ' — results are ready now'
              : ` — refresh fetches ${stats.data.estimatedFullRefreshQueries - stats.data.cachedQueries}`}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={() => start.mutate()}
          disabled={job.data?.status === 'running'}
          className="rounded bg-jade px-4 py-2 font-mono text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {job.data?.status === 'running' ? 'Searching…' : 'Refresh flight data'}
        </button>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="accent-jade" />
          re-fetch cached queries
        </label>
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
