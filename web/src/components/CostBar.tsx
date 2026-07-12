import type { CostBreakdown } from '@fwm/shared'

/**
 * Fixed cost-component order, labels and colors (validated categorical palette;
 * identity is always carried by labels alongside the color).
 */
export const COST_COMPONENTS = [
  { key: 'ticketsCents', label: 'tickets', color: '#4a3aa7' },
  { key: 'hotelCents', label: 'hotels', color: '#1baf7a' },
  { key: 'riskCents', label: 'split-ticket risk', color: '#eb6834' },
  { key: 'timeCents', label: 'travel time', color: '#2a78d6' },
  { key: 'oddHoursCents', label: 'odd hours', color: '#eda100' },
  { key: 'fairnessCents', label: 'unfairness', color: '#e87ba4' },
] as const satisfies readonly { key: keyof CostBreakdown; label: string; color: string }[]

/** "+$2,653 tickets · −$648 travel time" from a delta breakdown (non-zero terms). */
export function deltaSummary(d: CostBreakdown, money: (c: number) => string): string {
  return COST_COMPONENTS.filter((c) => d[c.key] !== 0)
    .map((c) => `${d[c.key] > 0 ? '+' : '−'}${money(Math.abs(d[c.key]))} ${c.label}`)
    .join(' · ')
}
