import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useEffect, useState } from 'react'
import type { PartyItineraryDto, ScoredOptionDto, SegmentDto, SoloCandidateDto } from '@fwm/shared'
import { linksForLegs, ticketLegs } from '../lib/booking.js'
import { carrierName } from '../lib/carriers.js'
import { useTripApiOptional } from '../lib/trip.jsx'
import { durationHM, localDateTime, money, shortDate } from '../lib/format.js'
import { COST_COMPONENTS } from './CostBar.js'
import { TrunkChip } from './TrunkChip.js'

const DELTA_EXPLANATIONS: Record<string, [positive: string, negative: string]> = {
  ticketsCents: ['more ticket money', 'cheaper tickets'],
  hotelCents: ['more positioning hotel nights', 'fewer positioning hotel nights'],
  riskCents: ['more parties on unprotected split tickets', 'fewer parties on split tickets'],
  timeCents: ['more time traveling', 'less time traveling'],
  oddHoursCents: ['worse flight times', 'nicer flight times'],
  fairnessCents: ['a bigger per-person price gap', 'a smaller per-person price gap'],
}

function CostExplainer({ scored }: { scored: ScoredOptionDto }) {
  const { benchmark, breakdown, deltaBreakdown, deltaVsBestCents, cashCents } = scored
  if (!breakdown || cashCents == null) return null

  if (benchmark || !deltaBreakdown || deltaVsBestCents == null) {
    return (
      <div className="space-y-1 rounded border border-jade/40 bg-jade-soft/40 p-3">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-jade">
          Benchmark — the strongest pick under your current knobs
        </h3>
        <p className="text-xs text-ink-soft">
          Cash: <span className="font-mono font-semibold">{money(cashCents)}</span>
          {breakdown.hotelCents > 0 &&
            ` (${money(breakdown.ticketsCents)} tickets + ${money(breakdown.hotelCents)} est. hotels)`}
          . Every other option's “vs best” figure is measured against this one.
        </p>
      </div>
    )
  }

  const rows = COST_COMPONENTS.filter((c) => deltaBreakdown[c.key] !== 0)
  return (
    <div className="space-y-2 rounded border border-line bg-white p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
          vs the benchmark, picking this effectively costs
        </h3>
        <span className="font-mono text-sm font-semibold">+{money(deltaVsBestCents)}</span>
      </div>
      <div className="space-y-1">
        {rows.map((c) => {
          const v = deltaBreakdown[c.key]
          const [pos, neg] = DELTA_EXPLANATIONS[c.key]!
          return (
            <div key={c.key} className="flex items-baseline gap-2 text-xs">
              <span className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: c.color }} />
              <span className="w-32 shrink-0">{c.label}</span>
              <span className="flex-1 text-ink-faint">{v > 0 ? pos : neg}</span>
              <span className={`font-mono ${v > 0 ? 'text-amber' : 'text-jade'}`}>
                {v > 0 ? '+' : '−'}
                {money(Math.abs(v))}
              </span>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-ink-faint">
        Time, risk and comfort are valued with your dollar knobs (under “fine-tune”), not billed —
        the unavoidable travel-time floor cancels out of this comparison.
      </p>
    </div>
  )
}

function SegmentRow({ s }: { s: SegmentDto }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border px-2 py-1.5 ${
        s.isTrunk ? 'border-jade/40 bg-jade-soft' : 'border-line bg-white'
      }`}
      title={`${carrierName(s.carrier)} ${s.carrier}${s.flightNumber}${s.durationMin ? ` · ${durationHM(s.durationMin)} in the air` : ''}`}
    >
      <span className="w-16 shrink-0 font-mono text-xs font-semibold">
        {s.carrier}
        {s.flightNumber}
      </span>
      <span className="font-mono text-sm font-medium">
        {s.origin} → {s.destination}
      </span>
      <span className="hidden text-xs text-ink-faint sm:inline">{carrierName(s.carrier)}</span>
      <span className="ml-auto whitespace-nowrap text-xs text-ink-soft">
        {localDateTime(s.departsLocal)} → {localDateTime(s.arrivesLocal)}
      </span>
      {s.isTrunk && (
        <span
          title="Everyone in the group is on this flight"
          className="rounded-sm bg-jade px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-white"
        >
          together
        </span>
      )}
    </div>
  )
}

function Layover({ s }: { s: SegmentDto }) {
  if (s.layoverBeforeMin == null) return null
  const long = s.layoverBeforeMin >= 6 * 60
  return (
    <div className={`pl-4 font-mono text-[11px] ${long ? 'text-amber' : 'text-ink-faint'}`}>
      ⏱ {durationHM(s.layoverBeforeMin)} {long ? 'wait' : 'layover'} in {s.origin}
    </div>
  )
}

function legElapsed(segs: SegmentDto[]): number | null {
  let total = 0
  for (const s of segs) {
    if (s.durationMin == null) return null
    total += s.durationMin + (s.layoverBeforeMin ?? 0)
  }
  return total
}

function Leg({ segs, label }: { segs: SegmentDto[]; label: string }) {
  if (segs.length === 0) return null
  const elapsed = legElapsed(segs)
  return (
    <>
      <div className="flex items-baseline justify-between pt-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{label}</span>
        {elapsed != null && (
          <span className="font-mono text-[10px] text-ink-faint">{durationHM(elapsed)} door-to-door</span>
        )}
      </div>
      {segs.map((s) => (
        <Fragment key={`${s.leg}${s.pos}`}>
          <Layover s={s} />
          <SegmentRow s={s} />
        </Fragment>
      ))}
    </>
  )
}

/** "If X flew alone instead" comparison against their unconstrained best —
 *  expandable to the exact itinerary the claim is based on. */
function SoloCompare({
  partyId,
  groupPpCents,
  groupDoorMin,
  solo,
}: {
  partyId: string
  groupPpCents: number
  groupDoorMin: number | null
  solo: SoloCandidateDto | undefined
}) {
  const api = useTripApiOptional() // null in frozen snapshot views
  const [open, setOpen] = useState(false)
  const detail = useQuery({
    queryKey: ['solo-itin', api?.tripId, solo?.itineraryId],
    queryFn: () => api!.getSoloItinerary(solo!.itineraryId),
    enabled: open && api != null && solo != null,
  })
  if (!solo) return null
  const priceDelta = groupPpCents - solo.perPersonCents
  const timeDelta = groupDoorMin != null ? groupDoorMin - solo.doorMin : null
  const fmtDelta = (v: number, fmt: (x: number) => string) =>
    `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}`
  return (
    <div className="space-y-1.5 rounded-sm bg-chart px-2 py-1.5 text-[11px] text-ink-soft">
      <p>
        If {partyId} flew alone instead ({shortDate(solo.depDate)} → {shortDate(solo.retDate)} —
        their own dates): {money(solo.perPersonCents)}/person ·{' '}
        {durationHM(solo.doorMin)} door-to-door — staying with the group costs{' '}
        <span className="font-mono font-semibold">
          {fmtDelta(priceDelta, money)}
          {timeDelta != null && ` · ${fmtDelta(timeDelta, durationHM)}`}
        </span>{' '}
        per person.{' '}
        {api ? (
          <button onClick={() => setOpen(!open)} className="font-mono text-jade underline">
            {open ? 'hide that itinerary' : 'see that itinerary'}
          </button>
        ) : (
          <span className="text-ink-faint">(flight details not stored in frozen snapshots)</span>
        )}
      </p>
      {open && detail.isLoading && <p className="text-ink-faint">Loading…</p>}
      {open && detail.isError && <p className="text-amber">Couldn't load it: {String(detail.error)}</p>}
      {open && detail.data && (
        <div className="space-y-1.5 border-t border-line pt-1.5">
          {/* isTrunk flags are meaningless here — flying alone, nobody is "together". */}
          {(['outbound', 'return'] as const).map((leg) => (
            <Leg
              key={leg}
              segs={detail.data.segments.filter((s) => s.leg === leg).map((s) => ({ ...s, isTrunk: false }))}
              label={leg === 'outbound' ? 'going' : 'coming home'}
            />
          ))}
          <BookLinks segments={detail.data.segments} />
        </div>
      )}
    </div>
  )
}

/** "verify & book: Kayak ↗ · Google Flights ↗" for one ticket's segments. */
function BookLinks({ segments }: { segments: SegmentDto[] | undefined }) {
  const links = linksForLegs(ticketLegs(segments ?? []))
  if (links.length === 0) return null
  return (
    <div
      className="flex items-baseline gap-2 font-mono text-[11px] text-ink-faint"
      title="Opens a live search for this route and dates — find the flight numbers shown here to confirm the fare still exists, and book there"
    >
      <span className="uppercase tracking-wider">verify & book:</span>
      {links.map((l) => (
        <a
          key={l.label}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-jade underline"
        >
          {l.label} ↗
        </a>
      ))}
    </div>
  )
}

function ItineraryBlock({
  itin,
  title,
  solo,
}: {
  itin: PartyItineraryDto
  title: string
  solo?: SoloCandidateDto
}) {
  const out = (itin.segments ?? []).filter((s) => s.leg === 'outbound')
  const ret = (itin.segments ?? []).filter((s) => s.leg === 'return')
  const groupDoor =
    legElapsed(out) != null && legElapsed(ret) != null ? legElapsed(out)! + legElapsed(ret)! : null
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <h4 className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">{title}</h4>
        <span className="font-mono text-sm font-semibold">
          {money(itin.totalCents, itin.currency)}
          <span className="ml-1 text-xs font-normal text-ink-soft">
            ({money(itin.perPersonCents, itin.currency)} × {itin.travelers}{' '}
            {itin.travelers === 1 ? 'person' : 'people'})
          </span>
        </span>
      </div>
      <Leg segs={out} label="going" />
      <Leg segs={ret} label="coming home" />
      <BookLinks segments={itin.segments} />
      {solo && (
        <SoloCompare
          partyId={itin.partyId}
          groupPpCents={itin.perPersonCents}
          groupDoorMin={groupDoor}
          solo={solo}
        />
      )}
    </div>
  )
}

function SelfTransferWait({
  minutes,
  airport,
  fromLocal,
  toLocal,
}: {
  minutes: number
  airport: string
  /** Landing time of the previous flight / departure time of the next (local ISO). */
  fromLocal?: string
  toLocal?: string
}) {
  const overnight = minutes >= 16 * 60
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-sm border border-amber/50 bg-amber-soft px-2 py-1.5 font-mono text-[11px] font-semibold text-amber">
      ⚠ {durationHM(minutes)} wait in {airport}
      {fromLocal && toLocal && (
        <span className="font-normal">
          {localDateTime(fromLocal)} → {localDateTime(toLocal)}
        </span>
      )}
      <span className="font-normal">
        — between two separate tickets{overnight ? ' (overnight — plan a hotel)' : ''}
      </span>
    </div>
  )
}

function TicketCaption({ text, price }: { text: string; price: string }) {
  return (
    <div className="flex items-baseline justify-between pt-1 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
      <span>{text}</span>
      <span>{price}</span>
    </div>
  )
}

/** A split-ticket journey as ONE continuous timeline per direction, with the
 *  self-transfer waits spelled out inline between tickets. */
function SplitJourney({
  split,
  solo,
}: {
  split: import('@fwm/shared').SplitTicketDto
  solo?: SoloCandidateDto
}) {
  const posOut = split.components.find((c) => c.kind === 'positioning_out')
  const trunk = split.components.find((c) => c.kind === 'trunk_only')
  const posBack = split.components.find((c) => c.kind === 'positioning_back')
  const posOutSegs = (posOut?.segments ?? []).filter((x) => x.leg === 'outbound')
  const trunkOut = (trunk?.segments ?? []).filter((x) => x.leg === 'outbound')
  const trunkRet = (trunk?.segments ?? []).filter((x) => x.leg === 'return')
  const posBackSegs = (posBack?.segments ?? []).filter((x) => x.leg === 'return')
  if (!posOut || !trunk || !posBack) return null

  const sum = (xs: (number | null)[]) => (xs.some((x) => x == null) ? null : xs.reduce((a, b) => a! + b!, 0))
  const goingMin = sum([legElapsed(posOutSegs), split.bufferOutMin, legElapsed(trunkOut)])
  const homeMin = sum([legElapsed(trunkRet), split.bufferBackMin, legElapsed(posBackSegs)])

  const rows = (segs: typeof posOutSegs) =>
    segs.map((s) => (
      <Fragment key={`${s.leg}${s.carrier}${s.flightNumber}${s.pos}`}>
        <Layover s={s} />
        <SegmentRow s={s} />
      </Fragment>
    ))

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between pt-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">going</span>
        {goingMin != null && (
          <span className="font-mono text-[10px] text-ink-faint">{durationHM(goingMin)} door-to-door</span>
        )}
      </div>
      <TicketCaption
        text={`ticket 1 — getting to ${trunkOut[0]?.origin ?? 'the meeting airport'}`}
        price={money(posOut.totalCents, posOut.currency)}
      />
      {rows(posOutSegs)}
      <BookLinks segments={posOut.segments} />
      <SelfTransferWait
        minutes={split.bufferOutMin}
        airport={trunkOut[0]?.origin ?? ''}
        fromLocal={posOutSegs[posOutSegs.length - 1]?.arrivesLocal}
        toLocal={trunkOut[0]?.departsLocal}
      />
      <TicketCaption
        text="ticket 2 — the shared flights (covers both directions)"
        price={money(trunk.totalCents, trunk.currency)}
      />
      {rows(trunkOut)}

      <div className="pt-1 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
        coming home {homeMin != null && <span className="float-right normal-case">{durationHM(homeMin)} door-to-door</span>}
      </div>
      {rows(trunkRet)}
      <BookLinks segments={trunk.segments} />
      <SelfTransferWait
        minutes={split.bufferBackMin}
        airport={trunkRet[trunkRet.length - 1]?.destination ?? ''}
        fromLocal={trunkRet[trunkRet.length - 1]?.arrivesLocal}
        toLocal={posBackSegs[0]?.departsLocal}
      />
      <TicketCaption
        text={`ticket 3 — getting home from ${trunkRet[trunkRet.length - 1]?.destination ?? 'the gateway'}`}
        price={money(posBack.totalCents, posBack.currency)}
      />
      {rows(posBackSegs)}
      <BookLinks segments={posBack.segments} />
      {solo && (
        <SoloCompare
          partyId={split.partyId}
          groupPpCents={split.perPersonCents}
          groupDoorMin={goingMin != null && homeMin != null ? goingMin + homeMin : null}
          solo={solo}
        />
      )}
    </div>
  )
}

export function OptionDrawer({
  id,
  scored,
  onClose,
  frozen = false,
  soloBest,
  viewer = null,
}: {
  id: string
  scored: ScoredOptionDto | null
  onClose: () => void
  /** Snapshot view: segments come from the frozen data; no live actions. */
  frozen?: boolean
  /** Per-party best fly-alone baseline (already picked for the active prefs). */
  soloBest?: Map<string, SoloCandidateDto>
  /** The traveler looking at the app — their sections come first, highlighted. */
  viewer?: string | null
}) {
  const qc = useQueryClient()
  const api = useTripApiOptional() // null in frozen snapshot views
  const detail = useQuery({
    queryKey: ['option', api?.tripId, id],
    queryFn: () => api!.getOption(id),
    enabled: !frozen && api != null,
  })
  const synth = useMutation({
    mutationFn: () => api!.synthesize(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['option', api?.tripId, id] })
      void qc.invalidateQueries({ queryKey: ['options', api?.tripId] })
    },
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const o = frozen ? scored : detail.data

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Option detail">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-line bg-paper p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h2 className="font-mono text-sm uppercase tracking-widest text-ink-faint">
              Option {id}
            </h2>
            {o && (
              <div className="flex flex-wrap gap-2">
                <TrunkChip trunk={o.outbound} />
                <TrunkChip trunk={o.ret} />
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded border border-line bg-white px-3 py-1 text-sm hover:bg-chart"
          >
            Close
          </button>
        </div>

        {detail.isLoading && <p className="text-ink-soft">Loading…</p>}
        {detail.isError && <p className="text-amber">Failed to load option: {String(detail.error)}</p>}

        {o && (
          <div className="space-y-6">
            {scored && <CostExplainer scored={scored} />}
            <div className="grid grid-cols-3 gap-3 rounded border border-line bg-white p-3 text-center">
              <div>
                <div className="font-mono text-lg font-semibold">{money(o.totalCents, o.currency)}</div>
                <div className="text-[11px] uppercase tracking-widest text-ink-faint">everyone, total</div>
              </div>
              <div>
                <div className="font-mono text-lg font-semibold">
                  {o.perPersonMinCents != null && o.perPersonMaxCents != null
                    ? `${money(o.perPersonMinCents, o.currency)}–${money(o.perPersonMaxCents, o.currency)}`
                    : '—'}
                </div>
                <div className="text-[11px] uppercase tracking-widest text-ink-faint">per person</div>
              </div>
              <div>
                <div className="font-mono text-lg font-semibold">
                  {o.metrics ? durationHM(o.metrics.total_travel_time) : '—'}
                </div>
                <div className="text-[11px] uppercase tracking-widest text-ink-faint">avg travel, round trip</div>
              </div>
            </div>

            {(() => {
              // The viewer's journey — single ticket or split — always renders first.
              const partyBlock = (p: (typeof o.parties)[number]) => (
                <div
                  key={`p-${p.partyId}`}
                  className={p.partyId === viewer ? 'rounded border-2 border-jade/60 bg-jade-soft/30 p-2' : ''}
                >
                  <ItineraryBlock
                    itin={p}
                    title={`${p.partyId}${p.partyId === viewer ? ' (you)' : ''} — one ticket, fully protected`}
                    solo={soloBest?.get(p.partyId)}
                  />
                </div>
              )
              const splitBlock = (s: (typeof o.splitTickets)[number]) => (
                <div
                  key={`s-${s.partyId}`}
                  className={`space-y-2 rounded border bg-amber-soft/50 p-3 ${
                    s.partyId === viewer ? 'border-2 border-jade/60' : 'border-amber/40'
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-amber">
                      {s.partyId}
                      {s.partyId === viewer ? ' (you)' : ''} — separate tickets
                    </h3>
                    <span className="font-mono text-sm font-semibold">{money(s.totalCents, s.currency)}</span>
                  </div>
                  <p className="text-xs text-ink-soft">
                    {s.partyId} books three separate tickets. <strong>The catch:</strong> if a positioning
                    flight is badly delayed, the airline won't rebook the shared flight — that's the trade
                    for the lower price. The waits between tickets are marked below.
                  </p>
                  <SplitJourney split={s} solo={soloBest?.get(s.partyId)} />
                </div>
              )
              const blocks = [
                ...o.parties.map((p) => ({ partyId: p.partyId, el: partyBlock(p) })),
                ...o.splitTickets.map((s) => ({ partyId: s.partyId, el: splitBlock(s) })),
              ]
              blocks.sort((a, b) => Number(b.partyId === viewer) - Number(a.partyId === viewer))
              return blocks.map((b) => b.el)
            })()}

            {o.missingParties.length > 0 && !frozen && (
              <div className="space-y-2 rounded border border-line bg-white p-3">
                <p className="text-sm text-ink-soft">
                  No single ticket puts{' '}
                  <span className="font-mono font-semibold">{o.missingParties.join(', ')}</span> on these
                  shared flights. They could still join by booking two separate tickets — a flight to the
                  meeting airport, plus the shared flights themselves. Press the button to price that out
                  with live fares.
                </p>
                <button
                  onClick={() => synth.mutate()}
                  disabled={synth.isPending}
                  className="rounded bg-board px-3 py-1.5 font-mono text-sm text-white hover:bg-ink disabled:opacity-50"
                >
                  {synth.isPending ? 'Pricing…' : 'Price split ticket'}
                </button>
                {synth.data && synth.data.reports.some((r) => !r.ok) && (
                  <ul className="text-xs text-amber">
                    {synth.data.reports
                      .filter((r) => !r.ok)
                      .map((r) => (
                        <li key={r.partyId}>
                          {r.partyId}: {r.reason}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}
