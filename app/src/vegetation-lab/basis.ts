/**
 * Botanical analogues for each candidate, and what is evidence-informed (E) or an artistic abstraction (A). These are references for
 * the growth rules in ecology.ts, not models of species, and none is calibrated.
 */
export const BASIS: Record<string, string> = {
  spar: 'Analogues: weeping, tiered crowns (willow-like) and crown shyness. E: lower branches shed as the crown lifts; shade stretches the leader; wind prunes the exposed side. A: the veils and the tier spacing.',
  parasol: 'Analogues: Begonia pavonina and Selaginella willdenowii (blue iridescent leaves of deep shade) and monolayer shade foliage. E: iridescent cell layers raise light capture in dim green light; one thin horizontal layer catches diffuse light; the golden angle between organs reduces self-shading; leaves fold from excess light. A: the dish form, the stacked tiers and the colours.',
  plate: 'Analogues: wind-pruned coastal trees and flat-topped savanna crowns. E: persistent exposure leans and asymmetrically prunes the crown; forks multiply with age. A: the double plates.',
  candelabra: 'Analogue: the dragon tree, which forks only after its first flowering. E: no branching while young, then regular dichotomy. A: the rosette shape and the leaf sizes.',
  buttress: 'Analogues: bald cypress and tupelo of flooded forest. E: buttressed bases and knees are common in saturated soil. A: the exact link between water depth and knee height (the function of knees is debated).',
  stilts: 'Analogue: mangrove prop roots. E: prop roots lengthen as the water deepens, and the trunk is raised on them. A: the parasol crown, and a strong depth response.',
  canes: 'Analogues: bramble and understory cane shrubs. E: canes are renewed from the base as it matures; shade stretches and arches them; sun shortens and branches them. A: the leaf shapes.',
  tabular: 'Analogues: shade-tolerant understory shrubs with layered branches (dogwood-like). E: the dimmer it is, the flatter and wider each tier. A: the regular tiers.',
  coppice: 'Analogue: coppicing shrubs, hazel-like. E: new shoots rise from the base with age; sun brings leafier shoots; exposure compacts. A: the whorled leaves.',
  rosette: 'Analogue: shade ferns. E: a young fern has few small fronds; fronds lie flat in shade and curl in drought. A: the pinna shape.',
  stolons: 'Analogue: stoloniferous ground cover (creeping herbs). E: foraging growth: short internodes and dense branching on rich ground, long sparse runners on poor ground. A: the pad leaves.',
  cushion: 'Analogue: moss and lichen cushions in rock crevices. E: they grow outward from where they start, dome up when damp and flatten when dry. A: the blade shapes.',
  vine: 'Analogue: ivy. E: juvenile and adult forms differ (small flat leaves; larger leaves held off the surface and side shoots); stems seek crevices. A: the leaf shapes and the adhesion roots.',
  curtain: 'Analogue: pendant mosses and lichens (old-man’s-beard). E: they live on air moisture and stop growing when it is dry. A: the beaded leaves.',
  brackets: 'Analogue: bromeliad-like tank rosettes. E: single rosettes make offsets as they mature; leaves fold upright in dry air. A: the strap-leaf shape.',
  reed: 'Analogue: common reed (Phragmites) and bulrush. E: emergent stems do best in shallow water and spread by rhizome; exposure shortens and stiffens them. A: the seed spikes.',
  sedge: 'Analogue: tussock sedges (Carex). E: tussocks widen with age and rise on a mound; deep water overtops the blades. A: the fountain shape.',
  broadleaf: 'Analogue: marginal herbs such as arrowhead and pickerel weed. E: leaves enlarge with maturity; exposure shrinks them. A: the paddle shape.',
  meadow: 'Analogue: eelgrass and other strap-leaved submerged plants. E: light at the bed falls with depth and limits growth; current shears blades short. A: the twist and the clump shape.',
  stonewort: 'Analogue: stoneworts and hornwort. E: whorls form on the stem and sit closer in more light. A: the regular whorl count.',
}
