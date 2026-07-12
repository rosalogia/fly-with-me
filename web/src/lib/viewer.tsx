import { createContext, useContext, useState } from 'react'

/** Which traveler is looking at the app (persisted per browser). */
const ViewerContext = createContext<{
  viewer: string | null
  setViewer: (v: string | null) => void
}>({ viewer: null, setViewer: () => {} })

const KEY = 'fwm-viewer'

export function ViewerProvider({ children }: { children: React.ReactNode }) {
  const [viewer, set] = useState<string | null>(() => localStorage.getItem(KEY))
  const setViewer = (v: string | null) => {
    set(v)
    if (v) localStorage.setItem(KEY, v)
    else localStorage.removeItem(KEY)
  }
  return <ViewerContext.Provider value={{ viewer, setViewer }}>{children}</ViewerContext.Provider>
}

export function useViewer() {
  return useContext(ViewerContext)
}

export function ViewerSelect({ parties, tone = 'dark' }: { parties: string[]; tone?: 'dark' | 'light' }) {
  const { viewer, setViewer } = useViewer()
  // A remembered viewer that no longer exists in the config counts as "everyone".
  const active = viewer && parties.includes(viewer) ? viewer : null
  const idle = tone === 'dark' ? 'text-paper/60 hover:text-white' : 'text-ink-soft hover:text-ink'
  const label = tone === 'dark' ? 'text-paper/50' : 'text-ink-faint'
  const border = tone === 'dark' ? 'border-paper/20' : 'border-line'
  const everyoneActive = tone === 'dark' ? 'bg-paper/20 text-white' : 'bg-board text-white'
  return (
    <div
      className="flex items-center gap-1 font-mono text-xs"
      title="Pick who you are — prices, badges and itineraries orient to you"
    >
      <span className={`uppercase tracking-widest ${label}`}>I'm</span>
      <div className={`flex rounded border p-0.5 ${border}`}>
        <button
          onClick={() => setViewer(null)}
          className={`rounded px-1.5 py-0.5 uppercase tracking-wider ${active === null ? everyoneActive : idle}`}
        >
          everyone
        </button>
        {parties.map((p) => (
          <button
            key={p}
            onClick={() => setViewer(p)}
            className={`rounded px-1.5 py-0.5 uppercase tracking-wider ${
              active === p ? 'bg-jade text-white' : idle
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}
