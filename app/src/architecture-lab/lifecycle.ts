/**
 * The Overhang's lifecycle in the Lab: one slider, seven stages, from a small anchored organism to low mineral remains.
 *
 * A position `L` (0 to 1) is turned into what each stage needs:
 *   age      the growth age (0 to 1; 1 is the approved mature form). Before maturity the generator builds the organism at that age: a
 *            closed solid of tissue that has arrived (the tower first, then the cantilever and its supports), not a cut-open shell
 *   live     how much of the surface is still living tissue (the rest is exposed mineral skeleton): the shader's mix
 *   dead     how weathered and stained the exposed mineral is
 *   recede   how deep (metres) the shaded, old tissue has eroded: cavities and holes, the skeleton showing through
 *   ruin     structural failure, 0 to 1: the cantilever breaks back and is gone, its piers fail, the towers lose their tops down to
 *            stumps; rubble lies on the ground and a mineral apron spreads around the footing
 * The stages differ in kind: Senescence decays and mineralises a structure that stands; Death ends the living tissue and begins
 * the collapse; Remains is what is left, low and broken.
 */
export type StageId = 'establishment' | 'juvenile' | 'growing' | 'maturity' | 'senescence' | 'death' | 'remains'
export type Stage = { id: StageId; label: string; from: number; to: number; short: string; note: string }

export const MATURITY = 0.5
export const STAGES: Stage[] = [
  { id: 'establishment', label: 'Establishment', from: 0, to: 0.08, short: 'A small anchored footing.', note: 'A small anchored organism: the footing and a first low mass.' },
  { id: 'juvenile', label: 'Juvenile', from: 0.08, to: 0.22, short: 'Early vertical growth.', note: 'Early vertical growth: the tower rises toward the light.' },
  { id: 'growing', label: 'Growing', from: 0.22, to: 0.5, short: 'Tower rises, cantilever and supports form.', note: 'The tower rises, the cantilever extends, the supports develop under it.' },
  { id: 'maturity', label: 'Maturity', from: 0.5, to: 0.58, short: 'The full form (approved baseline).', note: 'The full form: tower, cantilever, secondary masses and supports, undercroft.' },
  { id: 'senescence', label: 'Senescence', from: 0.58, to: 0.74, short: 'Skin decays, skeleton stands and weathers.', note: 'The living skin decays and mineralises, first in the shade; the skeleton still stands, weathering and opening.' },
  { id: 'death', label: 'Death', from: 0.74, to: 0.88, short: 'Life ends; collapse begins.', note: 'Biological activity ends. The cantilever breaks back, the piers fail, the towers lose their tops.' },
  { id: 'remains', label: 'Remains', from: 0.88, to: 1, short: 'Low mineral rubble and apron.', note: 'Broken down to low stumps, rubble and a mineral apron spread over the ground: sheltered gaps and mineral soil remain.' },
]
/** One sample of each stage, for the lifecycle contact sheet. */
export const STAGE_SAMPLES = [0.04, 0.15, 0.36, 0.54, 0.67, 0.81, 0.97]

export type LifePhase = { age: number; live: number; dead: number; recede: number; ruin: number; stage: Stage }
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export const stageOf = (L: number): Stage => STAGES.find((s) => L < s.to) ?? STAGES[STAGES.length - 1]!

export function lifeAt(L: number): LifePhase {
  const stage = stageOf(L)
  if (L < MATURITY) return { age: Math.max(0.02, L / MATURITY), live: 1, dead: 0, recede: 0, ruin: 0, stage }
  if (L < 0.58) return { age: 1, live: 1, dead: 0, recede: 0, ruin: 0, stage }
  if (L < 0.74) {
    // Senescence: the skin decays and mineralises; the structure stands.
    const s = clamp01((L - 0.58) / 0.16)
    return { age: 1, live: 1 - 0.85 * s, dead: 0.4 * s, recede: 4 * s, ruin: 0, stage }
  }
  if (L < 0.88) {
    // Death: no living tissue; collapse begins at once and goes far.
    const d = clamp01((L - 0.74) / 0.14)
    return { age: 1, live: 0.15 * (1 - clamp01(d * 2.5)), dead: 0.4 + 0.4 * d, recede: 4 + 2 * d, ruin: 0.05 + 0.63 * d, stage }
  }
  // Remains: broken down to low rubble.
  const m = clamp01((L - 0.88) / 0.12)
  return { age: 1, live: 0, dead: 1, recede: 6 + 3 * m, ruin: 0.68 + 0.32 * m, stage }
}
/** Whether the mesh itself changes with L. Maturity (the approved form) is the one mesh the generator makes; every other stage builds its own. */
export const needsRebuild = (L: number) => !(L >= MATURITY && L < 0.58)
