import type { MotionId, SpeciesId } from './types.ts'

/**
 * The lab's four species, and what each control means for each. Sizes are provisional: they come from the concept art and from the
 * need to read at the camera distances in 0.3, not from measurement. Anatomy references are starting points, not templates. Every
 * `controls` line says only what the code does with that control; a control a species does not use is absent.
 */
export type ControlKey = 'age' | 'condition' | 'mineral' | 'habitat' | 'pace' | 'bank'
export type ControlInfo = { label: string; tip: string }

export type SpeciesInfo = {
  id: SpeciesId
  label: string
  family: string
  /** What it does in the ecology (not simulated yet). */
  role: string
  /** The animal anatomy it borrows from, and what is its own. */
  anatomy: string
  /** What mineralization means for this species, and how it develops. */
  mineral: string
  size: string
  motions: { id: MotionId; label: string; note: string }[]
  /** The motion it shows in the line-up. */
  lineUp: MotionId
  /** Ground markers: spacing, half extent and dot radius in metres, and the shadow's reach, so motion over the ground reads. */
  ground: { spacing: number; extent: number; dot: number; shadow: number }
  controls: Partial<Record<ControlKey, ControlInfo>>
}

export const SPECIES: Record<SpeciesId, SpeciesInfo> = {
  dweller: {
    id: 'dweller',
    label: 'Hollow Dweller',
    family: 'Terrestrial · hollows and shelter',
    role: 'A keeper of the hollows under Living Architecture. It shelters in them and works them with its forepaws; later, its scraping and gnawing keeps cavities open and stops shaded old tissue from closing them.',
    anatomy: 'Reference: a badger’s hunched stance and a cat’s three-bone leg on its toes. Its own: short legs under a deep arched body, shovel forepaws, and a sleek, angular face: high cheekbones, a tapered muzzle, a heavy brow over narrow slanted eyes, pointed ears that swivel on their own.',
    mineral: 'Thickened skin laid down where its back rubs the hollow’s ceiling: a saddle of flat, overlapping scutes that starts at the withers and spreads toward the rump with age, and bands at the base of the tail. Pale where oldest. The claws are the same material.',
    size: 'about 1.2 m head and body, 0.4 m at the shoulder, with a 0.8 m tail (provisional)',
    motions: [
      { id: 'idle', label: 'Idle', note: 'Standing: breath, ears swivelling on their own, a slow look around, and now and then a sniff.' },
      { id: 'walk', label: 'Walk', note: 'A four-beat shuffle: shoulder rolls against hip, head low; each foot is carried back at the ground’s speed while it is down.' },
      { id: 'crouch', label: 'Crouch', note: 'Drops its belly almost to the ground, elbows out, ears flat, head forward, to go in under a low shelf. A stand-in shelf is drawn overhead.' },
      { id: 'run', label: 'Run', note: 'A gallop: the hind feet land one after the other, then the fore feet, the back flexes and extends through the stride, and there is one short flight with the legs gathered. Ears pinned back, tail streaming.' },
    ],
    lineUp: 'idle',
    ground: { spacing: 0.5, extent: 6, dot: 0.02, shadow: 5 },
    controls: {
      age: { label: 'Age', tip: 'Development, not just size. Young: round head, big ears and eyes, short muzzle, short limbs, a short tail, smooth shoulders and haunch, small claws, no scutes. Growing: the muzzle and limbs lengthen, the muscle fills out, the tail adds segments. Mature: the full face and saddle. Old: pale muzzle, a slight sag of the back, worn claws, some scutes chipped away.' },
      condition: { label: 'Condition', tip: 'Poor to thriving: body mass (girth through the body, limbs and tail) and how dull the coat is. It does not change proportions or mineral.' },
      mineral: { label: 'Mineral', tip: 'How much mineral it has taken up: how many scutes, how thick and pale, how many bands on the tail base. It is laid down over the years, so a young animal cannot show much, whatever it has taken up.' },
      habitat: { label: 'Hollow depth', tip: 'Open ground to a deep hollow: shorter legs and a lower body, bigger ears, smaller eyes, paler skin, longer claws.' },
      pace: { label: 'Pace', tip: 'Walking pace: how fast the legs cycle. The stride length stays the same.' },
    },
  },
  glider: {
    id: 'glider',
    label: 'Veil Glider',
    family: 'Aerial · wind and high shelves',
    role: 'Launches from high shelves and catches the propagules Architecture sheds on its hooked ray tips; later, it carries them farther than the Architecture can spread by itself.',
    anatomy: 'Reference: a gliding vertebrate (a forelimb with a wrist, a membrane held out on slender rays, like a bat’s hand or a flying fish’s fin). Its own: a hand-fan wing that folds against the flank, a tail fan, a big round head and a plume from the brow.',
    mineral: 'Stiffening of the rays, from their roots outward, the leading rays first: a calcified ray is thicker, paler and does not bend; an uncalcified one is thin, dark and ripples. The hooked tips are the ends of the stiffest rays, so only the leading rays have them.',
    size: 'about 1.9 m across the wings, 0.6 m body (provisional)',
    motions: [
      { id: 'perch', label: 'Perch', note: 'On a ledge, wings folded like a fan, feet gripping the bar, now and then a ruffle and a look around.' },
      { id: 'glide', label: 'Glide', note: 'A slow, level glide: wings and tail spread, soft rays rippling, legs tucked.' },
      { id: 'bank', label: 'Bank', note: 'Rolls into turns alternately: the outer wing opens, the tail steers, the head holds the horizon.' },
    ],
    lineUp: 'glide',
    ground: { spacing: 4, extent: 60, dot: 0.18, shadow: 8 },
    controls: {
      age: { label: 'Age', tip: 'Development. Young: a round, big-headed body, short wings of five rays, no layered feathers, a short plain tail, two filaments in the plume. Growing: rays, feather layers and tail rays are added and the wings lengthen. Mature: nine or ten rays, two layers of covert feathers, a seven-rayed tail with long outer streamers, a full plume. Old: the same, worn: blunted hooks, thinner coverts, bleached, a few filaments lost.' },
      condition: { label: 'Condition', tip: 'Poor to thriving: body mass (girth) and tears in the wing (shortened, ragged rays). It does not change how many rays or feathers it has.' },
      mineral: { label: 'Mineral', tip: 'Calcification of the rays, leading edge first: thicker, paler, stiffer (the wing flexes less), with hooked tips on the stiffest. It is laid down over the years, so a young glider has soft rays whatever it has taken up.' },
      habitat: { label: 'Exposure to wind', tip: 'Sheltered to windy: short broad wings with a big tail, to long narrow wings with more rays and a small tail.' },
      bank: { label: 'Bank angle', tip: 'The most it rolls into a turn. The turn rate follows from the roll and the speed.' },
    },
  },
  strider: {
    id: 'strider',
    label: 'Strider',
    family: 'Amphibious · deep water, shallows and shore',
    role: 'A shoreline forager. It swims the deep water, wades the shallows and walks the shore, stirring silt and mineral toward the land; later, its foraging feeds the toes of Architecture that stand at the water’s edge.',
    anatomy: 'Reference: a fish’s flat body, a horse’s springy upright leg and a swan’s curved neck. Its own: four limbs that grow out of muscular hips and tuck back along the flanks to swim, a dorsal sail, a fan tail, and a long neck that lets it feed with care.',
    mineral: 'Wet ground is where the mineral is. The legs, its most stressed part, lay it down as growth nodes at the knee and ankle (they thicken with age and supply), and as a pale crust that rises from the feet to as high as the water has stood. The body stays soft; a small gill-cover rim is the only mineral on it.',
    size: 'about 1.1 m tall to the top of its sail, 1.6 m long (provisional)',
    motions: [
      { id: 'stand', label: 'Stand', note: 'Standing on its limbs: the sail breathes, the tail fan sways, the neck turns.' },
      { id: 'wade', label: 'Wade', note: 'A slow walk: the body sways over the feet that carry it, the limbs lift high to clear the water and the head thrusts a little with each step.' },
      { id: 'swim', label: 'Swim', note: 'Afloat: the limbs tuck back along the flanks and the body and tail drive it forward in a wave. The water rises to meet it.' },
      { id: 'forage', label: 'Forage', note: 'Lowers its head and looks about, holds, strikes at the water and swallows, with the neck doing the work and the body staying steady.' },
    ],
    lineUp: 'stand',
    ground: { spacing: 0.5, extent: 6, dot: 0.02, shadow: 6 },
    controls: {
      age: { label: 'Age', tip: 'Development. Young: short, stout limbs, a small sail of four rays, a short three-rayed tail fan, a big head, a round body. Growing: the legs lengthen and slim, rays are added to the sail and tail. Mature: long legs, a tall many-rayed sail, a seven-rayed tail. Old: a bleached, stiffened, frayed sail and thicker knee and ankle nodes.' },
      condition: { label: 'Condition', tip: 'Poor to thriving: body mass (girth) and tears in the sail and tail (shortened rays). It does not change proportions.' },
      mineral: { label: 'Mineral', tip: 'Growth nodes at the knee and ankle, the crust rising up the legs, and the gill rim. They are laid down over the years, so a young Strider shows little.' },
      habitat: { label: 'Water depth', tip: 'Dry flats to deep shallows: longer legs, a higher crust, a higher lift when wading. The water in the scene rises with it.' },
      pace: { label: 'Pace', tip: 'Wading or swimming pace: how fast the legs, or the tail, cycle.' },
    },
  },
  crawler: {
    id: 'crawler',
    label: 'Litter Crawler',
    family: 'Detritivore · groundcover and debris',
    role: 'Roots through the litter under shelves with its flat snout, eating receded Architecture tissue and fallen plant matter and breaking it down into soil; later, it is the island’s recycler of what Architecture and plants shed.',
    anatomy: 'Reference: a woodlouse’s and a trilobite’s segmented shell, and a pangolin’s ability to roll. Its own: a low, flat body on short legs, a wedge head with a blunt rooting snout and tiny eyes, and a shell of overlapping keeled bands, a head shield and a tail shield over a soft belly.',
    mineral: 'The bands are the mineral. The animal lays it down a growth band at a time at the rear edge of each plate, from the litter it eats: young plates are soft and dark; with age it adds bands, and with supply the plates thicken and pale and show their newest band as a pale rim. The belly, face and legs stay soft.',
    size: 'about 0.4 m long with its tail when grown (provisional)',
    motions: [
      { id: 'idle', label: 'Idle', note: 'Still, now and then rooting in the litter with its nose down, chewing, and looking up again.' },
      { id: 'scuttle', label: 'Shuffle', note: 'A low four-beat crawl: the shell stays steady, the legs take short steps, and each foot is carried back at the ground’s speed while it is down.' },
      { id: 'curl', label: 'Roll up', note: 'Rolls into a ball when startled: the front and rear curl under, and the head, legs and belly are drawn inside the plates.' },
    ],
    lineUp: 'idle',
    ground: { spacing: 0.08, extent: 0.9, dot: 0.005, shadow: 0.9 },
    controls: {
      age: { label: 'Age', tip: 'Development. Hatchling: round and soft, four bands of plate, a big head, short snout, long legs for its size. Growing: bands are added one at a time at the rump, the body lengthens and flattens, the snout lengthens, the legs shorten under the shell, the plates harden. Mature: eight or nine bands with keels, a full head shield. Old: worn rims, some keels chipped, plates paler.' },
      condition: { label: 'Condition', tip: 'Poor to thriving: body mass (girth) and how bright the growth rims are. It does not change the number of bands.' },
      mineral: { label: 'Mineral', tip: 'How hard, thick and pale the plates, keels and head shield are, and how bright their growth rims. Laid down over the years: a hatchling stays soft.' },
      habitat: { label: 'Litter depth', tip: 'Thin to deep litter: a flatter body, shorter legs, a longer snout for rooting, smaller eyes.' },
      pace: { label: 'Pace', tip: 'Shuffle pace: how fast the legs cycle. The stride length stays the same.' },
    },
  },
}

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[]
