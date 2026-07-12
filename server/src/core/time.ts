import { DateTime } from 'luxon'

/** Parse a local ISO datetime (no offset) in the given IANA zone into an instant. */
export function toInstant(localIso: string, tz: string): DateTime {
  const dt = DateTime.fromISO(localIso, { zone: tz })
  if (!dt.isValid) throw new Error(`invalid datetime ${localIso} in ${tz}: ${dt.invalidReason}`)
  return dt
}

/** Minutes from instant A to instant B (positive when B is after A). */
export function minutesBetween(aLocal: string, aTz: string, bLocal: string, bTz: string): number {
  return Math.round(toInstant(bLocal, bTz).diff(toInstant(aLocal, aTz), 'minutes').minutes)
}

/** YYYY-MM-DD of a local ISO datetime. */
export function localDate(localIso: string): string {
  return localIso.slice(0, 10)
}

/** Local hour as a decimal (e.g. 17:30 -> 17.5). */
export function localHour(localIso: string): number {
  const h = Number(localIso.slice(11, 13))
  const m = Number(localIso.slice(14, 16))
  return h + m / 60
}

/** Add days to a YYYY-MM-DD date string. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Day of week (0=Sunday..6=Saturday) of a YYYY-MM-DD date string. */
export function dayOfWeek(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay()
}

/**
 * The "home by Sunday night" deadline for a trip returning on date R:
 * the Sunday of R's weekend (R itself if Sunday, else the next Sunday).
 */
export function sundayDeadline(returnDate: string): string {
  const dow = dayOfWeek(returnDate)
  const daysToSunday = dow === 0 ? 0 : 7 - dow
  return `${addDays(returnDate, daysToSunday)}T23:59:59`
}
