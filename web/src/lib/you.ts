import type { GroupOptionDto } from '@fwm/shared'

export interface YouPay {
  cents: number | null
  split: boolean
  missing: boolean
}

/** What the given traveler pays per person on this option (single or split ticket). */
export function youPay(o: GroupOptionDto, viewer: string): YouPay {
  const single = o.parties.find((p) => p.partyId === viewer)
  if (single) return { cents: single.perPersonCents, split: false, missing: false }
  const split = o.splitTickets.find((s) => s.partyId === viewer)
  if (split) return { cents: split.perPersonCents, split: true, missing: false }
  return { cents: null, split: false, missing: true }
}
