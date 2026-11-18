/**
 * Whether the world is being loaded behind a cover (the /preview website's loading screen), so nothing it draws is seen yet. While it
 * is, the work that is paced across frames to keep a visible scene smooth (the terrain's chunks, the plants' tiles, the start of the
 * ground's fields) may take bigger steps: the same work, in the same order, with the same results, done sooner. Off by default; the page
 * that shows the cover turns it on before the world mounts and off when the cover lifts.
 *
 * The plants report (WorldPlants.tsx) `plantsPending`, the Distant plant geometries still to grow, and `plantTiles`, the tiles of plants the view
 * still wants built (each −1 before the first count).
 *
 * `growIn` (off by default; the /preview site turns it on): plant tiles that appear after the cover has lifted grow to full size over a moment
 * instead of appearing at once.
 *
 * `creatureMarks` (off by default; /preview's Home turns it on): each animal shown as a small dot where it is (Creatures.tsx), for views from far off.
 *
 * `plantGrowth` (1 by default; /preview's World Formation moves it): how far the plants have grown in, 0 (none) to 1 (all). Below 1 each tile
 * grows in at its own moment within the range, so the plants spread across the island rather than all scaling at once (WorldPlants.tsx).
 */
export const loading = { covered: false, plantsPending: -1, plantTiles: -1, growIn: false, creatureMarks: false, plantGrowth: 1 }

/**
 * Where a point of the world falls on the page, in CSS pixels, as the 3D view currently sees it (lens shift included), and whether it is in front
 * of the camera. Set by the camera rig (LandscapeView.tsx) while the view is mounted; null otherwise. Read only: for annotations drawn over the world.
 */
export const viewProjector: { project: ((x: number, y: number, z: number) => { x: number; y: number; front: boolean }) | null } = { project: null }

/** Where one animal is now (a Hollow Dweller where there is one), reported by the creatures while their marks are on (Creatures.tsx). */
export const creatureSpot = { x: 0, y: 0, z: 0, valid: false }
