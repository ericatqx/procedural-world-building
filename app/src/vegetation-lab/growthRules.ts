/**
 * HOW EACH SPECIES IS GENERATED, in plain words: the growth rule its generator follows (the code is in cand*.ts), and what AGE adds or takes away.
 * These are not one L-system for every plant: each species has the rule that suits its life form. The `kind` names the course concept it uses.
 *
 *   monopodial      one leader that keeps growing; laterals in tiers along it (apical dominance)
 *   sympodial       no leader: new shoots from the base replace old ones (clonal renewal, coppicing)
 *   phyllotactic    organs placed around an axis by a fixed angle (the golden angle), each from the one before
 *   rosette         organs radiating from one point at ground level, oldest outermost
 *   clonal spread   runners branching over the ground, rooting and leafing at nodes (recursive branching on a surface)
 *   attachment      growth that follows a surface: a wall's depth decides where each shoot can go
 *   ribbon          flexible blades or ribbons that bend under their own weight, wind or current
 */
export type GrowthRule = { kind: string; rule: string; age: string }

export const GROWTH: Record<string, GrowthRule> = {
  spar: {
    kind: 'monopodial',
    rule: 'One leader grows straight up. Along it, tiers of 5–6 long near-level branches, each sagging with its own length and hung at intervals with clusters of broad pendant leaves. Branch length is set by height on the trunk and by light.',
    age: 'Seedling: a short leafy leader. Young: the first tiers. Mature: the crown lifts as the lowest tiers are shed. Old: veils thin, some limbs carry only short spent leaves.',
  },
  buttress: {
    kind: 'monopodial',
    rule: 'A leader with a weeping crown like the veil tree’s, on a trunk that flares into radial buttress fins, with a ring of knees rising from the roots around it. Fin height and knee count follow water depth.',
    age: 'Fins, knees and crown tiers are all added with age; the lowest tiers are shed as it matures.',
  },
  parasol: {
    kind: 'phyllotactic',
    rule: 'A slender stalk sets out light-dishes one above another, each turned from the last by the golden angle (137.5°) so none sits in another’s shadow. Each dish is a ring of overlapping wedges; the lower ones are wider.',
    age: 'Seedling: one dish at the tip. Each year of growth adds a tier higher on the stalk; old dishes fray and pale. Drought removes tiers.',
  },
  canes: {
    kind: 'sympodial',
    rule: 'No trunk: canes rise from the base in a ring, arch under their own weight and carry leaves in alternate pairs. In sun, short side shoots branch from the upper canes.',
    age: 'Young: a few unbranched canes. Each year adds basal canes (clonal renewal); old canes keep a few spent leaves.',
  },
  coppice: {
    kind: 'sympodial',
    rule: 'Many shoots from one base, fanning outward, each with whorls of 3–4 small leaves at regular steps. Sun gives short, dense, leafy shoots; shade fewer, longer, sparser ones.',
    age: 'Shoots are added from the base as it ages, from 3 to about 25.',
  },
  rosette: {
    kind: 'rosette',
    rule: 'Fronds radiate from one crown point, each turned from the last by about 2.4 turns over the crown; outer fronds are the oldest and longest. Each frond carries paired pinnae along its rachis.',
    age: 'Young: a few short, simple fronds. Mature: a full crown. Old: the outer fronds are spent.',
  },
  stolons: {
    kind: 'clonal spread',
    rule: 'Runners leave the centre, leafing at every node, and may fork into a new runner (a recursive rule, one level deep). Foraging growth: on rich, lit ground short steps and frequent forks (it stays and exploits); on poor ground long, sparse runners (it searches).',
    age: 'Age adds and lengthens runners; past mid-life the runners begin to fork, a second order of branching.',
  },
  cushion: {
    kind: 'clonal spread',
    rule: 'A dense dome of short shoots packed into a rock crevice, the crevice’s own shape deciding where it can grow; crustose lichen shares the rock.',
    age: 'The cushion widens along the crevice with age.',
  },
  vine: {
    kind: 'attachment',
    rule: 'Leaders climb the wall, each following the wall’s surface (its depth at every point); on rock they follow the wet crevice. Two forms of one plant (heteroblasty, as in ivy).',
    age: 'Juvenile: a slender climber with small leaves pressed flat to the wall. Adult: larger leaves held off it, and side shoots.',
  },
  curtain: {
    kind: 'attachment',
    rule: 'Strands hang from the top of an overhang and fall under their own weight, leafing along their length.',
    age: 'Strands lengthen with age.',
  },
  brackets: {
    kind: 'attachment',
    rule: 'Tank rosettes lodged on the wall (in a crevice on rock, on a ridge of architecture): a spiral of leaves that holds water at its centre.',
    age: 'Young: a single rosette. Mature: offsets beside it. Dry air folds the leaves upright.',
  },
  reed: {
    kind: 'ribbon',
    rule: 'A clump of tall stems from a creeping base, each a tapering blade that bends in the wind; flower plumes on mature stems.',
    age: 'The clump adds stems and height with age.',
  },
  sedge: {
    kind: 'ribbon',
    rule: 'A fountain of arching blades from one tussock, the outer ones bending furthest.',
    age: 'More, longer blades with age.',
  },
  broadleaf: {
    kind: 'rosette',
    rule: 'Broad leaves on long stalks from a base in the shallows, held above the water.',
    age: 'More leaves on longer stalks with age.',
  },
  meadow: {
    kind: 'ribbon',
    rule: 'Long ribbons anchored to the bed and lifted by the water, streaming with the current.',
    age: 'Ribbons lengthen toward the surface with age.',
  },
  stonewort: {
    kind: 'phyllotactic',
    rule: 'Upright stems with whorls of branchlets at regular nodes, each whorl a ring around the stem.',
    age: 'Stems add nodes and whorls with age.',
  },
}

/** The growth stages the Growth view marks on its timeline, as a share of the species' life (the island's age model, worldPlants.ts). */
export const STAGES: { at: number; label: string }[] = [
  { at: 0.06, label: 'Seedling' },
  { at: 0.25, label: 'Juvenile' },
  { at: 0.55, label: 'Young' },
  { at: 0.85, label: 'Mature' },
  { at: 1, label: 'Old' },
]
export const stageAt = (age: number) => [...STAGES].reverse().find((s) => age >= s.at - 0.02)?.label ?? 'Seedling'
