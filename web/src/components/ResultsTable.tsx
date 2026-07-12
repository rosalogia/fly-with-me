import type { ScoredOptionDto } from '@fwm/shared'
import { durationHM, money, shortDate } from '../lib/format.js'
import { youPay } from '../lib/you.js'
import { deltaSummary } from './CostBar.js'
import { TrunkChip } from './TrunkChip.js'

export type SortKey = 'cost' | 'cash' | 'per_person_max' | 'you' | 'fairness' | 'duration' | 'total_time'

const headers = (
  viewer: string | null,
): { key: SortKey | null; label: string; hint?: string; align?: 'right' }[] => [
  { key: 'cash', label: 'Cash', hint: 'Real money: tickets, plus estimated hotel nights when a party positions overnight' },
  { key: 'cost', label: 'Vs best', hint: 'What picking this option over the benchmark effectively costs, valuing time, risk and comfort with your knobs — hover for what drives it' },
  { key: null, label: 'Dates', hint: 'When you leave home → when you fly out of China' },
  { key: null, label: 'Flights together in', hint: 'The shared flights into China — everyone is on these' },
  { key: null, label: 'Flights together out', hint: 'The shared flights out of China' },
  viewer
    ? { key: 'you', label: `${viewer} pays`, hint: `Your ticket price per person (all travelers' range in the tooltip)`, align: 'right' }
    : { key: 'per_person_max', label: 'Per person', hint: 'Cheapest–priciest traveler (tickets only)', align: 'right' },
  { key: 'fairness', label: 'Spread', hint: 'Gap between the cheapest and priciest traveler', align: 'right' },
  { key: 'total_time', label: 'Door-to-door', hint: 'Average travel time per person, home to home, layovers included', align: 'right' },
  { key: null, label: '' },
]

function tripDays(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

export function ResultsTable({
  options,
  sort,
  onSort,
  onSelect,
  viewer = null,
}: {
  options: ScoredOptionDto[]
  sort: SortKey
  onSort: (k: SortKey) => void
  onSelect: (id: string) => void
  viewer?: string | null
}) {
  const HEADERS = headers(viewer)
  return (
    <div className="max-h-[70vh] overflow-auto rounded border border-line bg-white">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_var(--color-line)]">
          <tr className="text-left font-mono text-[11px] uppercase tracking-widest text-ink-faint">
            {HEADERS.map((h, i) => (
              <th
                key={i}
                title={h.hint}
                className={`px-3 py-2 font-medium ${h.align === 'right' ? 'text-right' : ''}`}
              >
                {h.key ? (
                  <button
                    onClick={() => onSort(h.key!)}
                    className={`uppercase tracking-widest hover:text-ink ${sort === h.key ? 'text-ink' : ''}`}
                  >
                    {h.label}
                    {sort === h.key ? ' ▾' : ''}
                  </button>
                ) : (
                  h.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {options.map((o) => (
            <tr
              key={o.id}
              onClick={() => onSelect(o.id)}
              className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-chart"
            >
              <td
                className="px-3 py-2"
                title={
                  o.breakdown && o.breakdown.hotelCents > 0
                    ? `${money(o.breakdown.ticketsCents)} tickets + ${money(o.breakdown.hotelCents)} est. hotels`
                    : undefined
                }
              >
                <span className="font-mono font-semibold">
                  {o.cashCents != null ? money(o.cashCents) : '—'}
                </span>
              </td>
              <td
                className="whitespace-nowrap px-3 py-2"
                title={
                  o.deltaBreakdown && !o.benchmark
                    ? `vs the benchmark: ${deltaSummary(o.deltaBreakdown, money)}`
                    : undefined
                }
              >
                <div className="flex items-center gap-2">
                  {o.benchmark ? (
                    <span className="rounded-sm bg-jade px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-white">
                      benchmark
                    </span>
                  ) : (
                    <span className="font-mono text-ink-soft">
                      {o.deltaVsBestCents != null ? `+${money(o.deltaVsBestCents)}` : '—'}
                    </span>
                  )}
                  {o.pareto && !o.benchmark && (
                    <span
                      title="Nothing else is cheaper AND faster AND fairer at the same time"
                      className="rounded-sm bg-jade-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-jade"
                    >
                      best
                    </span>
                  )}
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-ink-soft">
                {shortDate(o.pairDepart)} → {shortDate(o.pairReturn)}
                <span className="ml-1 font-mono text-xs text-ink-faint">
                  · {tripDays(o.pairDepart, o.pairReturn)}d
                </span>
              </td>
              <td className="px-3 py-2">
                <TrunkChip trunk={o.outbound} />
              </td>
              <td className="px-3 py-2">
                <TrunkChip trunk={o.ret} />
              </td>
              <td
                className="whitespace-nowrap px-3 py-2 text-right font-mono"
                title={
                  o.perPersonMinCents != null && o.perPersonMaxCents != null
                    ? `all travelers: ${money(o.perPersonMinCents, o.currency)}–${money(o.perPersonMaxCents, o.currency)}/person`
                    : undefined
                }
              >
                {viewer ? (
                  (() => {
                    const you = youPay(o, viewer)
                    if (you.missing) return <span className="text-ink-faint">no route for you</span>
                    return (
                      <span className="font-semibold text-ink">
                        {money(you.cents, o.currency)}
                        {you.split && (
                          <span className="ml-1 rounded-sm bg-amber-soft px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber">
                            2 tickets
                          </span>
                        )}
                      </span>
                    )
                  })()
                ) : (
                  <span className="text-ink-soft">
                    {o.perPersonMinCents != null && o.perPersonMaxCents != null
                      ? o.perPersonMinCents === o.perPersonMaxCents
                        ? money(o.perPersonMinCents, o.currency)
                        : `${money(o.perPersonMinCents, o.currency)}–${money(o.perPersonMaxCents, o.currency)}`
                      : '—'}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right font-mono text-ink-soft">
                {o.metrics ? money(o.metrics.fairness, o.currency) : '—'}
              </td>
              <td className="px-3 py-2 text-right font-mono text-ink-soft">
                {o.metrics ? durationHM(o.metrics.total_travel_time) : '—'}
              </td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-1">
                  {!(o.gatewayOutUS && o.gatewayInUS) && (
                    <span
                      title={`The group meets abroad: ${o.gatewayOut}${o.gatewayIn !== o.gatewayOut ? ` out, ${o.gatewayIn} back` : ''}`}
                      className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint"
                    >
                      via {o.gatewayOut}
                    </span>
                  )}
                  {o.splitParties.length > 0 && (
                    <span
                      title={`${o.splitParties.join(', ')} would fly on separate tickets (positioning flight + shared flight) — cheaper but not airline-protected if delayed`}
                      className="rounded-sm bg-amber-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber"
                    >
                      2 tickets: {o.splitParties.join(',')}
                    </span>
                  )}
                  {o.missingParties.length > 0 && (
                    <span
                      title="No priced route yet for these travelers — open the row and press “Price split ticket”"
                      className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint"
                    >
                      no route yet: {o.missingParties.join(',')}
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {options.length === 0 && (
            <tr>
              <td colSpan={HEADERS.length} className="px-3 py-10 text-center text-ink-soft">
                No options yet. Go to Trip setup and press “Refresh flight data”.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
