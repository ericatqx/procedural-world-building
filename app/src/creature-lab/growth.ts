import { clamp, smooth } from './geo.ts'

/**
 * How a creature develops with age, as three separate curves that every species reads in its own way. Age is anatomy, not size alone:
 *   maturity  0 (newborn) to 1 (fully grown, reached by about 0.7): proportions, how many segments, rays, feathers or plates it has,
 *             how developed its limbs, fins and face are
 *   elder     0 to 1 over the oldest part of the range: accumulated wear and slow change (worn plates, frayed tips, greying, a
 *             little sag), which does not mean ill health
 * Condition (health and body mass) and mineral (what has been deposited) are separate controls and are not derived from these.
 */
export const maturity = (age: number) => smooth(clamp((age - 0.08) / 0.62))
export const elder = (age: number) => smooth(clamp((age - 0.78) / 0.22))
export const stageName = (age: number) => (age < 0.3 ? 'juvenile' : age < 0.6 ? 'growing' : age < 0.82 ? 'mature' : 'old')
