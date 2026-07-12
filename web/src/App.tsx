import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { globalApi } from './api/client.js'
import { TripProvider, useTripApi } from './lib/trip.jsx'
import { ViewerProvider, ViewerSelect } from './lib/viewer.jsx'
import { AboutPage } from './pages/AboutPage.js'
import { ConfigPage } from './pages/ConfigPage.js'
import { HomePage } from './pages/HomePage.js'
import { ResultsPage } from './pages/ResultsPage.js'
import { SnapshotPage } from './pages/SnapshotPage.js'

type Tab = 'options' | 'setup' | 'about'

function Header({ children, subtitle }: { children?: React.ReactNode; subtitle?: string }) {
  return (
    <header className="border-b border-line bg-board text-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-6 gap-y-2 px-4 py-3">
        <a href="/" className="font-mono text-lg font-semibold tracking-tight text-white">
          fly<span className="text-amber-300">·</span>with<span className="text-amber-300">·</span>me
        </a>
        {subtitle && (
          <span className="font-mono text-xs uppercase tracking-widest text-paper/50">{subtitle}</span>
        )}
        {children}
      </div>
    </header>
  )
}

export function App() {
  const path = window.location.pathname
  const snapshotId = path.match(/^\/s\/([A-Za-z0-9_-]+)/)?.[1] ?? null
  const tripId = path.match(/^\/t\/([A-Za-z0-9_-]+)/)?.[1] ?? null
  const isAbout = path === '/about'

  return (
    <ViewerProvider>
      {snapshotId ? (
        <div className="min-h-screen">
          <Header subtitle="shared snapshot" />
          <main className="mx-auto max-w-6xl px-4 py-6">
            <SnapshotPage id={snapshotId} />
          </main>
        </div>
      ) : tripId ? (
        <TripProvider tripId={tripId}>
          <TripApp tripId={tripId} />
        </TripProvider>
      ) : isAbout ? (
        <div className="min-h-screen">
          <Header subtitle="about">
            <a href="/" className="font-mono text-sm uppercase tracking-wider text-paper/60 hover:text-white">
              ← all searches
            </a>
          </Header>
          <main className="mx-auto max-w-6xl px-4 py-6">
            <AboutPage />
          </main>
        </div>
      ) : (
        <div className="min-h-screen">
          <Header subtitle="group flight search">
            <a
              href="/about"
              className="ml-auto rounded px-3 py-1 font-mono text-sm uppercase tracking-wider text-paper/60 hover:text-white"
            >
              About
            </a>
          </Header>
          <main className="mx-auto max-w-6xl px-4 py-6">
            <HomePage />
          </main>
        </div>
      )}
    </ViewerProvider>
  )
}

function TripApp({ tripId }: { tripId: string }) {
  const initialTab = new URLSearchParams(window.location.search).get('tab')
  const [tab, setTab] = useState<Tab>(initialTab === 'setup' ? 'setup' : 'options')
  const api = useTripApi()
  const trip = useQuery({ queryKey: ['trip', tripId], queryFn: () => globalApi.getTrip(tripId) })
  const stats = useQuery({ queryKey: ['stats', tripId], queryFn: api.getStats, refetchInterval: 15000 })

  if (trip.isError) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="mx-auto max-w-6xl px-4 py-6 space-y-2">
          <p className="text-amber">This search doesn't exist (or was deleted).</p>
          <a href="/" className="text-sm text-jade underline">
            Back to all searches
          </a>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Header subtitle={trip.data?.name}>
        <nav className="flex gap-1 text-sm">
          {(
            [
              ['options', 'Options'],
              ['setup', 'Trip setup'],
              ['about', 'About'],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 font-mono uppercase tracking-wider transition-colors ${
                tab === t ? 'bg-paper/15 text-white' : 'text-paper/60 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          {trip.data && <ViewerSelect parties={trip.data.config.parties.map((p) => p.id)} />}
          <div className="font-mono text-xs text-paper/50">
            {stats.data
              ? `${stats.data.itineraries} itineraries cached · ${
                  stats.data.lastFetchedAt
                    ? `fetched ${new Date(stats.data.lastFetchedAt).toLocaleString()}`
                    : 'no data yet'
                }`
              : '…'}
          </div>
        </div>
      </Header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {/* All tabs stay mounted so switching never loses in-progress edits. */}
        <div className={tab === 'options' ? '' : 'hidden'}>
          <ResultsPage />
        </div>
        <div className={tab === 'setup' ? '' : 'hidden'}>
          <ConfigPage />
        </div>
        <div className={tab === 'about' ? '' : 'hidden'}>
          <AboutPage />
        </div>
      </main>
    </div>
  )
}
