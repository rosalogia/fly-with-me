import type {
  CacheStatsDto, CostPrefs, DatePair, GroupOptionDto, RefreshJobDto, ScoredOptionDto,
  SoloCandidateDto, TripConfig,
} from '@fwm/shared'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

export interface SoloItineraryDetail {
  itineraryId: number
  partyId: string
  travelers: number
  perPersonCents: number
  currency: string
  depDate: string
  retDate: string
  segments: import('@fwm/shared').SegmentDto[]
}

export interface TripMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  config: TripConfig
}

export interface HistoryEntry {
  id: number
  savedAt: string
  config: TripConfig
}

export interface SnapshotMeta {
  id: string
  name: string
  createdAt: string
  provider: string
  optionCount: number
  url: string
}

export interface Snapshot extends SnapshotMeta {
  config: TripConfig
  prefs: CostPrefs
  query: { gateways?: string | null; includeIncomplete?: boolean; top?: number | null }
  options: ScoredOptionDto[]
  solo: SoloCandidateDto[]
}

/** Global (not trip-scoped) API. */
export const globalApi = {
  listTrips: () => req<TripMeta[]>('/api/trips'),
  createTrip: (body: { name: string; config?: TripConfig; cloneFrom?: string }) =>
    req<TripMeta>('/api/trips', { method: 'POST', body: JSON.stringify(body) }),
  getTrip: (id: string) => req<TripMeta>(`/api/trips/${id}`),
  renameTrip: (id: string, name: string) =>
    req<TripMeta>(`/api/trips/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteTrip: (id: string) => req<{ ok: true }>(`/api/trips/${id}`, { method: 'DELETE' }),
  getJob: (id: string) => req<RefreshJobDto>(`/api/refresh/${id}`),
  listSnapshots: () => req<SnapshotMeta[]>('/api/snapshots'),
  getSnapshot: (id: string) => req<Snapshot>(`/api/snapshots/${id}`),
}

export interface TripApi {
  tripId: string
  getConfig: () => Promise<TripConfig>
  putConfig: (cfg: TripConfig) => Promise<TripConfig>
  getDatePairs: () => Promise<DatePair[]>
  startRefresh: (force: boolean) => Promise<RefreshJobDto>
  getOptions: () => Promise<ScoredOptionDto[]>
  getOption: (id: string) => Promise<GroupOptionDto>
  synthesize: (id: string) => Promise<{
    option: GroupOptionDto
    reports: { partyId: string; ok: boolean; reason?: string }[]
  }>
  getStats: () => Promise<CacheStatsDto>
  getSolo: () => Promise<SoloCandidateDto[]>
  getSoloItinerary: (id: number) => Promise<SoloItineraryDetail>
  getHistory: () => Promise<HistoryEntry[]>
  restoreHistory: (id: number) => Promise<TripConfig>
  createSnapshot: (body: {
    name?: string
    prefs?: string
    gateways?: string | null
    includeIncomplete?: boolean
    top?: number
  }) => Promise<SnapshotMeta>
}

/** API bound to one trip. */
export function tripApi(tripId: string): TripApi {
  const base = `/api/trips/${tripId}`
  return {
    tripId,
    getConfig: () => req(`${base}/config`),
    putConfig: (cfg) => req(`${base}/config`, { method: 'PUT', body: JSON.stringify(cfg) }),
    getDatePairs: () => req(`${base}/date-pairs`),
    startRefresh: (force) => req(`${base}/refresh`, { method: 'POST', body: JSON.stringify({ force }) }),
    getOptions: () => req(`${base}/options?includeIncomplete=1`),
    getOption: (id) => req(`${base}/options/${id}`),
    synthesize: (id) => req(`${base}/options/${id}/synthesize`, { method: 'POST' }),
    getStats: () => req(`${base}/cache/stats`),
    getSolo: () => req(`${base}/solo`),
    getSoloItinerary: (id) => req(`${base}/solo/${id}`),
    getHistory: () => req(`${base}/config/history`),
    restoreHistory: (id) => req(`${base}/config/history/${id}/restore`, { method: 'POST' }),
    createSnapshot: (body) => req(`${base}/snapshots`, { method: 'POST', body: JSON.stringify(body) }),
  }
}
