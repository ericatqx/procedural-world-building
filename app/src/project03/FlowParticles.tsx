import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial } from 'three'
import { getExplore } from './exploreData.tsx'
import { riverNetwork } from './riverNetwork.ts'
import { diagUniforms } from './visualDiagnostics.ts'
import type { World } from './world.ts'

/**
 * EXPLORE'S WATER FLOW, AS MOTION: restrained arrow marks on each river's own centreline (its node chain, source to mouth: rivers.ts), EVENLY
 * spaced along it and moving together at one steady pace per river (faster on a river that falls faster), like a conveyor: no random scatter, no
 * respawning, so they never bunch into clusters or leave gaps. They fade in at the source and out where the river ends, in a lake or at the
 * island's edge; where it joins another river they run on to the junction. Lakes have none: still water stays still. Drawn only while Explore's
 * Water flow lens is on (the lens drawing, uDiagSoft).
 */
/** Metres between marks along a river. */
const SPACING = 48
const MAX = 1400
const FADE = 24
// (A dark teal-black: it reads on the bright river and on the pale land beside a narrow one alike.)
const COLOUR = new Color('#10292A')

type P = { river: number; k: number }

export function FlowParticles({ world }: { world: World }) {
  const net = useMemo(() => riverNetwork(world), [world])
  // Each river's pace (m/s), from its mean fall; and how far its marks have moved.
  const pace = useMemo(() => net.rivers.map((r, ri) => Math.min(26, 9 + ((r.nodes[0]!.level - r.nodes[r.nodes.length - 1]!.level) / Math.max(1, net.length[ri]!)) * 900)), [net])
  const phase = useMemo(() => net.rivers.map(() => Math.random() * SPACING), [net])
  const { points, geometry, material, particles, step } = useMemo(() => {
    const particles: P[] = []
    const total = net.length.reduce((a, l) => a + l, 0)
    // (A very long network spaces its marks out a little more, never bunches them.)
    const stretch = Math.max(1, total / SPACING / MAX)
    net.rivers.forEach((_, ri) => {
      const n = Math.floor(net.length[ri]! / (SPACING * stretch)) + 2
      for (let k = 0; k < n; k += 1) particles.push({ river: ri, k })
    })
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(particles.length * 3), 3))
    geometry.setAttribute('alpha', new BufferAttribute(new Float32Array(particles.length), 1))
    geometry.setAttribute('aDir', new BufferAttribute(new Float32Array(particles.length * 2), 2))
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: COLOUR } },
      vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
attribute float alpha; attribute vec2 aDir; varying float vAlpha; varying float vAngle;
void main() {
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // The river's direction here, as it falls on the screen: the arrow is turned to it.
  vec4 ahead = projectionMatrix * modelViewMatrix * vec4(position + vec3(aDir.x, 0.0, aDir.y) * 6.0, 1.0);
  vec2 d = ahead.xy / ahead.w - gl_Position.xy / gl_Position.w;
  d.x *= projectionMatrix[1][1] / projectionMatrix[0][0];
  vAngle = atan(d.y, d.x);
  // A fine mark: about 14 px near, 9 px far.
  gl_PointSize = clamp(16.0 * projectionMatrix[1][1] * 600.0 / -mv.z, 11.0, 17.0);
  #include <logdepthbuf_vertex>
}`,
      fragmentShader: `#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; varying float vAlpha; varying float vAngle;
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
void main() {
  #include <logdepthbuf_fragment>
  // Into the arrow's own frame (its shaft along +x), then a shaft and two barbs, drawn as fine lines.
  vec2 p = gl_PointCoord - 0.5;
  p.y = -p.y;
  float c = cos(vAngle), s = sin(vAngle);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  float d = min(seg(q, vec2(-0.42, 0.0), vec2(0.4, 0.0)), min(seg(q, vec2(0.4, 0.0), vec2(0.16, 0.15)), seg(q, vec2(0.4, 0.0), vec2(0.16, -0.15))));
  float a = 1.0 - smoothstep(0.05, 0.095, d);
  if (a <= 0.01) discard;
  gl_FragColor = vec4(uColor, vAlpha * a);
  #include <colorspace_fragment>
}`,
    })
    const points = new Points(geometry, material)
    points.frustumCulled = false
    points.renderOrder = 5
    points.visible = false
    return { points, geometry, material, particles, step: SPACING * stretch }
  }, [net])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame((_, delta) => {
    const on = getExplore().view === 'water' && diagUniforms.uDiagSoft.value > 0.5
    points.visible = on
    if (!on) return
    const dt = Math.min(0.1, delta)
    const pos = geometry.getAttribute('position') as BufferAttribute
    const alpha = geometry.getAttribute('alpha') as BufferAttribute
    const dir = geometry.getAttribute('aDir') as BufferAttribute
    net.rivers.forEach((_, ri) => (phase[ri] = (phase[ri]! + dt * pace[ri]!) % step))
    particles.forEach((p, k) => {
      const r = net.rivers[p.river]!
      const along = net.along[p.river]!
      const end = net.length[p.river]!
      const d = p.k * step + phase[p.river]!
      if (d > end) {
        alpha.setX(k, 0)
        return
      }
      const i = Math.max(0, Math.min(r.nodes.length - 2, upper(along, d) - 1))
      const a = r.nodes[i]!
      const b = r.nodes[i + 1]!
      const t = Math.max(0, Math.min(1, (d - along[i]!) / Math.max(0.001, along[i + 1]! - along[i]!)))
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len = Math.hypot(dx, dz) || 1
      pos.setXYZ(k, a.x + dx * t, a.level + (b.level - a.level) * t + 0.45, a.z + dz * t)
      dir.setXY(k, dx / len, dz / len)
      // Faded in at its source (a river that leaves a lake starts at once), out where it ends; a junction carries it on.
      const kind = net.next[p.river]!.kind
      const fin = net.source[p.river]! >= 0 ? 1 : Math.min(1, d / FADE)
      const fout = kind === 'join' ? 1 : Math.min(1, (end - d) / FADE)
      alpha.setX(k, 0.85 * fin * fout)
    })
    pos.needsUpdate = true
    alpha.needsUpdate = true
    dir.needsUpdate = true
  })

  return <primitive object={points} />
}

/** The first index whose value is above `d` (the node after the particle). */
function upper(a: Float32Array, d: number): number {
  let lo = 0
  let hi = a.length - 1
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (a[m]! <= d) lo = m + 1
    else hi = m
  }
  return lo
}
