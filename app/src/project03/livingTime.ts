/**
 * Shadow Ecology 0.3 — Living Architecture's time: how the organism's lifecycle age (livingLife.ts: 0 at germination,
 * 1 at the mature reference form) follows the world's clock.
 *
 * The organism lives on a longer clock than the sun and the weather: years. The world's year is part of the
 * deterministic world time alongside the day and the hour, and the age is a pure function of the three, so any time
 * can be visited, in any order, and always shows the same organism. The day and the hour still advance the age (a
 * little: a year is 365 days), so a running day is, strictly, a little growth.
 *
 * The timescale is provisional. The reference form is not the end of its life: years past it are its later life
 * (continued growth, recession, regeneration and senescence: livingEcology.ts), where the effects of creatures will go.
 * The reference organism keeps this timescale exactly; the rest of the population develops at its own vigor.
 */
export const LIFECYCLE = {
  /** The year the organism germinates (age 0). */
  germination: 0,
  /** The year it reaches the reference form (age 1); the world opens here. */
  reference: 120,
  /** The last year the timeline reaches, for now (not a death date: lifespans are the ecology's, see livingEcology.ts). */
  horizon: 300,
}

/**
 * The world year in which observation begins (Day 1). It is the calendar's, not an event: the world is already living, each
 * organism at its own age; the reference organism happens to have reached its reference form in this year, which is only how
 * its own clock is calibrated.
 */
export const OBSERVATION_START = LIFECYCLE.reference

const DAYS_PER_YEAR = 365

/** World time in years: the year, and the day and hour as a fraction of a year. */
export function worldYears(year: number, hours: number): number {
  return year + hours / 24 / DAYS_PER_YEAR
}

/** The lifecycle age at a year and a time in hours since Day 1, 00:00. */
export function lifecycleAge(year: number, hours: number): number {
  return (year + hours / 24 / DAYS_PER_YEAR - LIFECYCLE.germination) / (LIFECYCLE.reference - LIFECYCLE.germination)
}

/** A word for where the organism is in its life. */
export function lifeStage(age: number): string {
  if (age < 0.05) return 'germinating'
  if (age < 0.85) return 'growing'
  if (age < 1) return 'maturing'
  return age < 1.0001 + 1 / (LIFECYCLE.reference - LIFECYCLE.germination) ? 'reference form' : 'mature'
}
