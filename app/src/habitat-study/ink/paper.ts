import { BackSide, Color, MeshBasicMaterial, MeshLambertMaterial, type Side } from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { SITE } from '../site.ts'

/**
 * Style B — The Field Notebook: the paper, the inks and the pen.
 *
 * Every surface is paper. Light does not model it: lit and turned faces are the same blank sheet, and only shadow is laid in, as the faintest cool
 * tone with a hand-cut edge. The drawing is all in lines: real line geometry (stable as the camera moves, each line there because a form needs it).
 */
export const INK = {
  paper: '#f3ede1',
  shadowTone: '#e6e1d8',
  ink: '#2b2620',
  sepia: '#4a4038',
  graphite: '#6e675d',
  faint: '#9a9184',
  wash: '#a9bcc4',
} as const

const HEAD = /* glsl */ `
varying vec3 vInkW;
`
const VERT = /* glsl */ `
  {
    vec4 inkW = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
    inkW = instanceMatrix * inkW;
    #endif
    vInkW = (modelMatrix * inkW).xyz;
  }
`
const FRAG = /* glsl */ `
{
  vec3 base = diffuseColor.rgb;
  float lum = max(0.002, dot(base, vec3(0.3333)));
  float lit = clamp(dot(reflectedLight.directDiffuse, vec3(0.3333)) / lum, 0.0, 1.0);
  // The shadow's edge, cut by hand: the threshold wanders a little over the ground.
  float wob = sin(vInkW.x * 0.9 + sin(vInkW.z * 0.7) * 1.8) * sin(vInkW.z * 1.1 + vInkW.y * 0.6) * 0.05;
  float t = smoothstep(0.07 + wob, 0.12 + wob, lit);
  outgoingLight = mix(base * vec3(0.948, 0.952, 0.966), base, t);
}
`

/** Paper: blank where lit or turned, the faintest cool tone where shadow falls. Pushed back a little in depth so lines on it always win. */
export function paperMaterial({ color = INK.paper, vertexColors = false, side }: { color?: string; vertexColors?: boolean; side?: Side } = {}) {
  // With vertex colours the colour is in the vertices (paper, or the wash), not multiplied by paper again.
  const m = new MeshLambertMaterial({ color: vertexColors ? '#ffffff' : color, vertexColors, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2, ...(side !== undefined ? { side } : {}) })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('void main() {', `${HEAD}void main() {`).replace('#include <project_vertex>', `#include <project_vertex>\n${VERT}`)
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `${HEAD}void main() {`).replace('#include <opaque_fragment>', `${FRAG}\n#include <opaque_fragment>`)
  }
  m.customProgramCacheKey = () => 'ink-paper'
  return m
}

/**
 * A pen's silhouette: the back faces pushed out along their normals by a share of their distance (a near-constant width on screen), the width
 * swelling and thinning along the form like a nib's pressure. Works for instanced plants as for the architecture.
 */
export function hullMaterial(color: string, width: number) {
  const m = new MeshBasicMaterial({ color, side: BackSide })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWidth = { value: width }
    shader.vertexShader = shader.vertexShader.replace('void main() {', 'uniform float uWidth;\nvoid main() {').replace(
      '#include <project_vertex>',
      `vec4 inkP = vec4(transformed, 1.0);
      vec3 inkN = normal;
      #ifdef USE_INSTANCING
      inkP = instanceMatrix * inkP;
      inkN = mat3(instanceMatrix) * inkN;
      #endif
      vec4 mvPosition = modelViewMatrix * inkP;
      vec3 inkWP = (modelMatrix * inkP).xyz;
      float press = 0.45 + 0.95 * (0.5 + 0.5 * sin(inkWP.x * 0.55 + sin(inkWP.z * 0.4) * 2.3 + inkWP.y * 0.8));
      mvPosition.xyz += normalize(normalMatrix * inkN) * (-mvPosition.z) * uWidth * press;
      gl_Position = projectionMatrix * mvPosition;`,
    )
  }
  m.customProgramCacheKey = () => `ink-hull-${width}`
  return m
}

// ------------------------------------------------------------------------------------------------------------- the pen

export type V3 = [number, number, number]

/** A smooth wobble field, for a hand's tremor and for where a line lifts off the paper. */
export const wobble = (x: number, y: number, z: number) => Math.sin(x * 1.3 + Math.sin(z * 0.9) * 1.7) * Math.sin(z * 1.1 + y * 0.8 + Math.sin(x * 0.6) * 1.3)

const paperC = new Color(INK.paper)
const tmp = new Color()

/**
 * Collects line segments with their ink. A line fades into the paper toward the window's edge (the drawing is vignetted, never cut), and can be
 * broken into a hand's dashes: where the wobble field is low the pen lifts.
 */
export class Pen {
  pos: number[] = []
  col: number[] = []
  name: string
  constructor(name: string) {
    this.name = name
  }
  seg(a: V3, b: V3, ink: Color) {
    const fade = (p: V3) => {
      const e = Math.max(Math.abs(p[0] - SITE.cx), Math.abs(p[2] - SITE.cz)) / SITE.half
      return Math.min(1, Math.max(0, (e - 0.62) / 0.36))
    }
    tmp.copy(ink).lerp(paperC, fade(a) ** 1.5)
    this.col.push(tmp.r, tmp.g, tmp.b)
    tmp.copy(ink).lerp(paperC, fade(b) ** 1.5)
    this.col.push(tmp.r, tmp.g, tmp.b)
    this.pos.push(...a, ...b)
  }
  /** A polyline, optionally broken where the pen lifts (`lift` 0: never, 0.3: often). */
  poly(points: V3[], ink: Color, lift = 0) {
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = points[i]!
      const b = points[i + 1]!
      if (lift > 0 && wobble(a[0] * 0.7 + 3, a[1] * 0.7, a[2] * 0.7) < -1 + lift * 2) continue
      this.seg(a, b, ink)
    }
  }
}

/** Fat lines in CSS pixels, their colour per vertex, fading into the paper-coloured fog with distance. */
export function penLines(pen: Pen, width: number, opacity = 1): LineSegments2 {
  const g = new LineSegmentsGeometry()
  g.setPositions(pen.pos)
  g.setColors(pen.col)
  const m = new LineMaterial({ color: 0xffffff, linewidth: width, vertexColors: true, transparent: opacity < 1, opacity, worldUnits: false })
  m.fog = true
  const l = new LineSegments2(g, m)
  l.frustumCulled = false
  l.name = pen.name
  return l
}
