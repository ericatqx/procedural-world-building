import { sunAt } from '../project/sun.ts'
import { scanArchitecture, traceNow, updateFields } from '../project02/fields.ts'
import type { Runtime } from '../project02/runtime.ts'
import { seedVegetation } from '../project02/vegetation.ts'
import { placeOrganism } from './organism.ts'

/**
 * Replaces 0.2's scattered sites with the one shore organism, traces its
 * shade, and reseeds vegetation onto that light.
 */
export function prepareCatchment(rt: Runtime) {
  const { eco, statics } = rt
  placeOrganism(eco, statics)
  scanArchitecture(eco.fields, statics, eco.arch)
  const traced = traceNow(rt.trace, statics, eco.arch, eco.noon)
  eco.fields.insolation = traced
  eco.fields.sunMemory.set(traced)
  updateFields(eco.fields, statics, eco.weather, 0, sunAt(eco.hour, eco.noon).daylight)
  eco.veg.plants = []
  eco.veg.nextId = 1
  eco.veg.clock = 0
  eco.fields.shelterCover.fill(0)
  eco.fields.exposureCover.fill(0)
  seedVegetation(eco.veg, statics, eco.fields, eco.rng)
  rt.settings.growing = false
  rt.scannedVersion = eco.arch.version
}
