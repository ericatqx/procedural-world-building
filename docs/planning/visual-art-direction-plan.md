# Shadow Ecology 0.3: Visual Art Direction, rendering audit and plan

> Status: **audit and plan only.** No shaders, palettes or rendering systems changed. The world, procedural systems and architecture stay as they are.
> Earlier groundwork: [Art Direction Brief](shadow-ecology-art-direction-brief.md) (its "light simplifies, shade elaborates" principle still applies) · the Habitat Study styles A, B, B2 and C (`app/src/habitat-study/`).

## 1. How the 0.3 world renders today

**Frame.**
- One `<Canvas>` (`ShadowEcology03.tsx` ~440): `antialias`, `logarithmicDepthBuffer`, `dpr` 1–1.5, PCF shadows, three's default ACES tone mapping with exposure set each frame.
- **No post-processing:** no `EffectComposer`, no outline or edge pass, no colour grade.
- Everything is drawn in one forward pass.

| Element | Where | Material | Shared hooks it uses |
|---|---|---|---|
| **Lighting and sky** | `Sky.tsx` | Key directional light (sun, a 4096² shadow map fitted around the camera's focus and redrawn only on change), moon, fill, hemisphere light. Exposure, a black background, fog colour from day and weather ("day air", haze), rain and splashes | `styleScalars` (key, fill, fog factors) |
| **Fog and mist** | `mist.ts` | Linear fog plus a second, height- and weather-driven mist term | `applyMist(shader)`, used by almost every material |
| **Terrain** | `LandscapeView.tsx` ~330, `terrainMesh.ts`, `vegGround.ts`, `archGround.ts` | `MeshStandardMaterial` with vertex colours (the 0.1/0.2 palette `PROJECT_COLORS`: strata, deep…), wetness darkening and gloss. `applyVegGround` paints vegetation tint, ground cover, overlays, picking, and **persistent shade** from `uArchShade` | `applyMist`, `applyVegGround`, `applyStyleFinish('terrain')` |
| **Living Architecture** | `livingMaterial.ts` (`createGrownMaterial`), `LivingArchitecture.tsx` ~640 | `MeshStandardMaterial` whose colour and relief read the growth record on each vertex (rings, age, vitality, stress, seams, moisture, rain streaks). Lifecycle (young, dying), custom depth material | `applyMist`, `applyStyleFinish('architecture')` |
| **Plants** | `WorldPlants.tsx`, `worldPlants.ts`, `vegetation-lab/geo.ts` | Instanced, vertex-coloured `MeshStandardMaterial`, three levels of detail, per-species tint | `applyMist`, `applyPlantStyle` (contrast grade, the Glow for shade-lovers, style finish) |
| Older plant stands | `Vegetation.tsx` | flat-shaded standard material, plus overlay meshes | `applyMist` |
| **Creatures** | `Creatures.tsx` ~584 | standard materials per body | `applyStyleFinish('creature')` |
| **Water** | `WaterLayer.tsx`, `water.ts` | `MeshStandardMaterial` (roughness 0.3), plus a transparent second layer | `applyMist`, `applyStyleFinish('water')` |
| **Visual Experiments** | `visualStyle.ts`, Advanced → Visual experiments | Six presets (Original, Contrast, Glow, Hybrid, Sculpt, Ink). Shared uniform objects (`visualUniforms`, `styleUniforms`, `styleScalars`) feed the shared hooks, so switching is instant | `applyStyleFinish(shader, kind)`: bands, monochrome, world-space hatching (`styStrokes`, density adjusted to screen size so it doesn't shimmer), rim contour, lift |

**Shared vs element-specific.**
- **Shared:** `applyMist`, `applyStyleFinish` (one anchor before the opaque output, checked so a missing anchor leaves the material unchanged), the shared uniform objects, the `uArchShade` and `uArch` rasters, and the Sky's fog and light.
- **Element-specific:** albedo sources (terrain vertex palette, architecture growth record, plant species tints, creature colours, water colour), plant LOD, and the architecture lifecycle material.

**Surface textures.** There are no image textures; all surface detail is procedural noise in shaders, plus the island rasters (vegetation tint, ground cover, persistent shade).

**Persistent shade already exists as data.**
- `archGround.ts` keeps an island-wide texture: R is the share of the day's sun the structures keep off each spot; G is a second shade term. Plants are placed from the same habitat raster.
- **Today** it is drawn only on the terrain, as a cool tint plus a moss-green wash (`vegGround.ts` ~86). That's the "coloured overlay" to move away from.
- **Moment-to-moment cast shadow** is the shadow map. The style finish can already tell it apart in a shader: direct light received divided by the face's albedo (`styLit`).

**Reusable ideas from the Habitat Study** (a separate scene, not the world):
- a per-hour palette with a shadow hue that swings with the sky, and a three-tone ramp (`sculpt/palette.ts`, `ramp.ts`);
- graphite hatching that follows form or light, a cobalt pigment wash with granulation, and baked recess occlusion (`ink2/graphite.ts`);
- a notan value scale and the clay occlusion bake (`compose/notan.ts`, `forms.ts`).

## 2. Direction (brief)

| Reference | What we take | Where it shows |
|---|---|---|
| Monument Valley | flat, calm lit planes; few large value groups; elegant key light; composed views | lit architecture and terrain; the plates |
| Sable | colour relationships (a coloured shadow hue, a limited palette), **fine** lines, stylised two- or three-tone shading | the whole palette; line weight |
| Path to Mnemosyne | sketch marks, hatching, strong tonal contrast | **only in persistent shade**, denser up close |
| Studio Ghibli | air: aerial perspective, soft haze, warm light; small signs of life | fog and air colour; plant motion and creatures (already there) |

**Two kinds of dark, with two identities:**
- **Shadow** (moment to moment, moving with the sun): a flat, coloured plane of the palette's shadow hue, with a clean edge and no marks. Graphic: Sable and Monument Valley.
- **Shade** (persistent, ecological: `uArchShade`): a different material state rather than a darker colour. Lower value, its own hue family, fine hatching or stipple marks that thicken with how persistent the shade is and how close you are, a damp sheen, a slight self-light on shade-loving plants. Drawn: Mnemosyne.

A spot can be in shadow but not shade (flat colour, no marks) or in shade but sunlit for a moment (marks under light). That contrast is the ecological signal, with no overlay colour needed.

## 3. Proposed experiments

### Shared foundation (needed by both): Art plates and art tokens

1. **Art plate**, a repeatable view:
   - **Actions:** `worldActions.art.plate(id)` sets the year (120), hour (16:30), clear weather and the paused clock, then a fixed camera pose. A small new camera hook is needed: today `lookCloser` gives a deterministic view of a selection, but there is no explicit pose action.
   - **Plates:** *A*, the reference Overhang from the Approach distance, with a lake edge, trees and its cast shadow in frame; *B*, eye level under the shelf looking out; *C*, a high overview for distance and air.
   - **Location:** a dev-only "Art direction" disclosure in Advanced settings, beside Visual experiments.
2. **`artDirection.ts`**, palette tokens as shared uniforms, exactly as `visualStyle.ts` does:
   - **Sky and light:** sky top and horizon, air (fog), key-light tint, cast-shadow hue and mix.
   - **Shade:** hue, value and mark colour.
   - **Elements:** terrain lit and turned, strata accent, architecture lit / turned / deep, foliage sun and shade, water, the accent.
   - Switching a palette sets uniforms only: no rebuild, no recompile.

### Experiment 1: palettes (the smallest useful first step)

- **How:** one new finish, `applyPaletteFinish(shader, kind)`, inserted at the same checked anchor as `applyStyleFinish`. It classifies each fragment as lit, turned, cast shadow or persistent shade (`styLit`, plus a world-xz sample of `uArchShade`), and maps the element's own albedo luminance onto the palette's colours for that state. Shapes, procedural detail and growth markings are kept.
- **What it doesn't touch:** albedo generation, geometry or placement. Sky and fog colours come from the same tokens through `styleScalars`.

| Palette | Lit world | Cast shadow | Persistent shade | Water / accent |
|---|---|---|---|---|
| **Mineral Twilight** | pale bone and limestone, cool grey-green foliage | dusk violet-slate | deep indigo-teal, cold marks | dark mirror slate / a single ember |
| **Painted Earth** | ochre, sienna, warm sage | warm umber-violet | deep green-umber, damp | muted teal / oxide red |
| **Pale World / Deep Shade** | near-white, high key, minimal colour | light grey-blue | near-black ink-teal with dense pale marks | pale grey / none |
| **Cobalt / Olive / Rust** (STYLE-GUIDE A) | `#E6E6E6` light, `#74776B` olive ground and foliage | cool olive-grey | deep olive-black | `#0047AB` cobalt water / `#A3320B` rust for age and stress |

**Comparison:** the same three plates at 16:30 and 11:00, saved as one contact sheet, plus Original. That's four palettes × three plates × two hours: 24 images, made by one scripted call. **Decision criterion:** does persistent shade read as its own place at distance, without the overlay?

### Experiment 2: rendering (after a palette is chosen)

Separately switchable, so each can be judged alone:

| Feature | Approach | Reuses | New |
|---|---|---|---|
| **Stylised tonal shading** | a three-step ramp from lit to turned to cast shadow, with soft band edges | Sculpt ramp idea, `uStyBands` | ramp per palette, in the finish |
| **Sketch marks in shade** | world-space hatching or stipple whose density follows `uArchShade` × closeness; direction follows the slope (ground) or the strata (architecture); pale marks on dark | `styStrokes` (already distance-stable) | gating by persistent shade, not by light; mark colour from tokens |
| **Fine linework** | a screen-space edge pass on depth and normals (thin, coloured as the darker neighbour, thinner in light), *or* a cheaper in-shader line on creases and silhouettes for architecture only | the rim contour (`uStyRim`) as a fallback | **post-processing**: `EffectComposer`, a normal/depth target and an edge shader. The only new rendering stage |
| **Atmospheric depth** | aerial perspective toward the palette's air colour; height mist in hollows; less contrast with distance | `mist.ts`, Sky's day air | token-driven air colour; a contrast-falloff term |

## 4. Reuse vs new

- **Reuse:**
  - the shared finish insertion point and anchor checks;
  - the shared uniform pattern and preset UI;
  - `styStrokes` hatching;
  - the `uArchShade` and `uArch` rasters, and the `styLit` cast-shadow test;
  - `applyMist` and the Sky's fog control;
  - the Habitat Study palette and ramp ideas.
- **New:**
  - `artDirection.ts` (tokens and palettes);
  - `applyPaletteFinish` (the shade sample in every material: plants, water and architecture currently don't read `uArchShade`);
  - art plates (a camera pose action, a dev panel, a contact-sheet capture);
  - post-processing for linework (experiment 2 only).

## 5. Smallest useful first experiment

**Art plates, `artDirection.ts`, and `applyPaletteFinish` for terrain and architecture only**, with two palettes (Pale World / Deep Shade, and Cobalt / Olive / Rust) against Original on plate A.

That tests the core question: can shadow and persistent shade read differently through palette and value alone, without linework? It's about a day's work and touches no geometry. Plants, water and the other two palettes follow once the mapping works.

## 6. Risks

- **Tone mapping:** ACES desaturates and shifts hues, so palette colours won't land as specified. Palettes may need their own tone-mapping or exposure setting, or NoToneMapping with a hand-made curve. Decide early.
- **Shader variants:** each new finish adds code to every material. Use shared uniforms, not compile-time defines, as `visualStyle` does, to avoid recompiles and program growth. The anchor checks must stay, or one material can silently go unstyled.
- **Plants are the fill-rate hot spot:** thousands of instanced, double-sided, alpha-free leaves; per-fragment hatching there is the costliest step. Gate the marks by distance and by shade, and give plants a cheaper path.
- **Post-processing with `logarithmicDepthBuffer`:** edge detection on depth needs the log depth linearised, or a separate normal/depth pass. It also adds a full-screen pass and render targets at `dpr` 1.5, and it interacts with the transparent water layer and the dissolve between architecture meshes. That's why it comes second.
- **Shadow map:** 4096², fitted around the focus. Flat coloured shadows will show the map's resolution at its edges more than soft shading does; may need a smaller fit in Explore.
- **Persistent-shade raster resolution:** it's island-wide and coarse, so sampling it on plants and architecture may look blocky up close. A blur or noise-broken edge is likely needed.
- **Labs:** they share `livingMaterial.ts` and the vegetation shaders (`createGrownMaterial`, plant LODs). The finish must be inert at its default so the labs and Habitat Study don't change.
