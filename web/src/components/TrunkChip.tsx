import type { TrunkLegSummary } from '@fwm/shared'
import { carrierName } from '../lib/carriers.js'

/** Departure-board style tile for a trunk leg: flight numbers + route. */
export function TrunkChip({ trunk }: { trunk: TrunkLegSummary }) {
  const flights = trunk.segments.map((s) => `${s.carrier}${s.flightNumber}`).join(' → ')
  const route = [trunk.segments[0]?.origin, ...trunk.segments.map((s) => s.destination)].join('–')
  const airlines = [...new Set(trunk.segments.map((s) => carrierName(s.carrier)))].join(' + ')
  return (
    <span
      className="inline-flex flex-col rounded-sm bg-board px-2 py-1 leading-tight text-white"
      title={`${airlines} — the flights everyone shares (${trunk.segments[0]?.date})`}
    >
      <span className="font-mono text-[13px] font-semibold tracking-wide">{flights}</span>
      <span className="font-mono text-[10px] uppercase tracking-widest text-white/60">{route}</span>
    </span>
  )
}
