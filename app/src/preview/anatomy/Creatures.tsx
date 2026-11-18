import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { buildCrawler } from '../../creature-lab/crawler.ts'
import { buildDweller } from '../../creature-lab/dweller.ts'
import { buildGlider } from '../../creature-lab/glider.ts'
import { SPECIES } from '../../creature-lab/species.ts'
import { buildStrider } from '../../creature-lab/strider.ts'
import type { Creature, CreatureParams, MotionId, SpeciesId } from '../../creature-lab/types.ts'
import { Exhibit, INK, Key, Seg, useWidth } from './common.tsx'
import { sunAt } from '../../project/sun.ts'
import { formatHour } from '../clock.ts'

/**
 * CREATURES. The question: how is a body built, and how does behaviour move it? One diagram: the rig the builder lays down, drawn from the side
 * and run, live, in the motion each behaviour state calls for (rest, travel, forage, return: the island's state machine, Creatures.tsx), through
 * the creature's own update (creature-lab, read only), so choosing a state shows the same bones doing what that state does. Age rebuilds it.
 *
 * A body built by the same builders the world's animals are built by (creature-lab, read only: the island calls them in
 * Creatures.tsx), taken apart. ANATOMY: the bones the builder lays down for this species at this age (a rig of bones, each with its parent),
 * drawn from the side in their bind pose; age changes the proportions, not only the size. RIGGING: the bones skin two meshes (tissue and mineral)
 * in one draw call each. BEHAVIOUR: the island's animals run one state machine (Creatures.tsx): rest, travel, forage, return; what moves them
 * from one state to the next differs by species.
 */
const BUILD: Record<SpeciesId, (p: CreatureParams) => Creature> = { dweller: buildDweller, crawler: buildCrawler, strider: buildStrider, glider: buildGlider }
const ORDER: SpeciesId[] = ['dweller', 'crawler', 'strider', 'glider']

/** The island's state machine, as Creatures.tsx runs it: what each state is, and what moves an animal on. */
const STATES = [
  { key: 'rest', label: 'Rest', what: 'In its resting place: a Dweller in the shade or hollow of its structure, a Crawler in its litter, a Strider in its shallow.', on: 'Hunger, and the hour: a Dweller goes out at dusk and night (or by day if hungry enough); a Strider works the shore by day; a Crawler stays under cover while the sun is on its ground.' },
  { key: 'travel', label: 'Travel', what: 'Walking to the feeding place it chose: the best food within its range, weighed against distance and cover.', on: 'Arriving starts feeding; a blocked way turns it back.' },
  { key: 'forage', label: 'Forage', what: 'Feeding at the patch: energy rises, the patch is grazed.', on: 'Fed, or the patch grazed out: it goes back; still hungry: on to the next patch. Sun reaching a Crawler’s ground, or nightfall for a Strider, sends it home early.' },
  { key: 'return', label: 'Return', what: 'Going back to its resting place.', on: 'Arriving, it rests; if the way is blocked it takes another resting place.' },
]

/** The motion each state of the island's state machine plays, from the species' own motions (species.ts). */
function motionFor(species: SpeciesId, state: string): MotionId {
  const have = new Set(SPECIES[species].motions.map((m) => m.id))
  const first = (...ids: MotionId[]) => ids.find((id) => have.has(id)) ?? SPECIES[species].motions[0]!.id
  if (state === 'rest') return first('crouch', 'curl', 'stand', 'perch', 'idle')
  if (state === 'forage') return first('forage', 'idle', 'stand')
  return first('walk', 'scuttle', 'wade', 'glide')
}

/**
 * WHAT THE ISLAND'S ANIMALS DO, BY THE LIGHT (Creatures.tsx, read, not changed): the daylight a species reads is the sun's (project/sun.ts),
 * and its thresholds are the ones its behaviour uses. A Hollow Dweller treats daylight above 45% as day: it lies up then (in the deepest shade it
 * can find) and feeds at dusk and by night. A Strider works the shallows while daylight is above 15%. A Litter Crawler answers to the sun on its
 * own ground: it forages under 35% and curls up against the sun over 45%, so in a structure's shade it can feed while the open ground is too
 * bright. A Veil Glider roosts once daylight falls under 12%. (The shaded case lets 15% of the sun through: an illustration of deep shade, not a
 * measured value.)
 */
const daylight = (h: number) => sunAt(((h % 24) + 24) % 24, 55).daylight
function stateAt(species: SpeciesId, h: number, ground: 'open' | 'shaded'): string {
  const d = daylight(h)
  // (By day a Dweller whose resting place the sun reaches moves round its structure into the shade again: Creatures.tsx, rest.)
  if (species === 'dweller') return d > 0.45 ? (ground === 'shaded' ? 'rest' : 'return') : 'forage'
  if (species === 'strider') return d > 0.15 ? 'forage' : 'rest'
  if (species === 'crawler') {
    const sunOnGround = ground === 'shaded' ? d * 0.15 : d
    return sunOnGround > 0.45 ? 'rest' : sunOnGround < 0.35 ? 'forage' : 'travel'
  }
  return d < 0.12 ? 'rest' : 'travel'
}
function why(species: SpeciesId, h: number, ground: 'open' | 'shaded'): string {
  const d = daylight(h)
  const p = `${Math.round(d * 100)}%`
  if (species === 'dweller') return d > 0.45 ? (ground === 'shaded' ? `Daylight ${p}, but its ground is in the structure’s shade: it lies up here.` : `Daylight ${p} and the sun on its ground: it moves round its structure into the shade.`) : `Daylight ${p}: dusk or night, when it goes out to feed, in the open or not.`
  if (species === 'strider') return d > 0.15 ? `Daylight ${p}: it works the lake shallows by day. Shade makes no difference to it.` : `Daylight ${p}: night, it stands still in its shallow.`
  if (species === 'crawler') {
    const sg = ground === 'shaded' ? d * 0.15 : d
    return `Sun on its ground ${Math.round(sg * 100)}%${ground === 'shaded' ? ' (canopy or a structure keeps most of it off)' : ''}: ${sg > 0.45 ? 'it curls up against the sun.' : sg < 0.35 ? 'it roots in the litter.' : 'it shuffles for cover.'}`
  }
  return d < 0.12 ? `Daylight ${p}: it roosts.` : `Daylight ${p}: it glides the woodland edge, in sun or shade alike.`
}

/** A day of its life: the daylight over 24 hours (filled), the species' own threshold (red line), and when it is resting (grey) or active (red). */
function DayStrip({ species, hour, ground, onHour, width }: { species: SpeciesId; hour: number; ground: 'open' | 'shaded'; onHour: (h: number) => void; width: number }) {
  const W = width
  const H = 96
  const X = (h: number) => 8 + (h / 24) * (W - 16)
  const pts: string[] = []
  for (let h = 0; h <= 24; h += 0.25) pts.push(`${X(h).toFixed(1)},${(60 - daylight(h) * 50).toFixed(1)}`)
  const bands: { from: number; to: number; active: boolean }[] = []
  for (let h = 0; h < 24; h += 0.25) {
    const active = stateAt(species, h + 0.125, ground) !== 'rest'
    const last = bands[bands.length - 1]
    if (last && last.active === active) last.to = h + 0.25
    else bands.push({ from: h, to: h + 0.25, active })
  }
  const threshold = species === 'dweller' ? (ground === 'shaded' ? 0.45 : 2) : species === 'strider' ? 0.15 : species === 'glider' ? 0.12 : ground === 'shaded' ? 2 : 0.45
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className="pv-an-day"
      role="img"
      aria-label="Its day: daylight and when it is active"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onHour(Math.max(0, Math.min(23.9, ((((e.clientX - r.left) / r.width) * W - 8) / (W - 16)) * 24)))
      }}
    >
      <polygon points={`${X(0)},60 ${pts.join(' ')} ${X(24)},60`} fill="rgba(242,228,196,0.18)" stroke="rgba(242,228,196,0.6)" />
      {threshold <= 1 ? <line x1={X(0)} x2={X(24)} y1={60 - threshold * 50} y2={60 - threshold * 50} stroke={INK.signal} strokeDasharray="3 3" /> : null}
      {bands.map((b, i) => (
        <rect key={i} x={X(b.from)} y={68} width={X(b.to) - X(b.from)} height={8} fill={b.active ? INK.signal : 'rgba(233,230,223,0.25)'} />
      ))}
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} x={X(h)} y={92} fontSize="9" textAnchor="middle" fill="rgba(233,230,223,0.55)" fontFamily="ui-monospace, monospace">
          {String(h).padStart(2, '0')}
        </text>
      ))}
      <line x1={X(hour)} x2={X(hour)} y1={4} y2={78} stroke="#E9E6DF" />
    </svg>
  )
}

/** What each species asks of light, in one line. */
const PREFERS: Record<SpeciesId, string> = {
  dweller: 'Seeks deep shade by day, under its structure; feeds at dusk and night',
  crawler: 'Answers to the sun on its own patch of ground: feeds while it is shaded, curls up in sun',
  strider: 'Tolerates full sun; works the lake shallows by day, and shade plays no part',
  glider: 'Flies in sun or shade alike while there is daylight; away at night',
}
/**
 * Where each species actually lives (Creatures.tsx, its habitat line), and so which grounds are worth comparing: a Dweller in the open or under its
 * structure; a Crawler in open litter or under cover (a canopy or a structure); a Strider only in the lake shallows (0.08 to 0.45 m), where shade
 * plays no part; a Glider along the woodland edge, in the air.
 */
const CONTEXTS: Record<SpeciesId, { key: 'open' | 'shaded'; label: string }[]> = {
  dweller: [
    { key: 'open', label: 'In the open' },
    { key: 'shaded', label: 'Under its structure' },
  ],
  crawler: [
    { key: 'open', label: 'Open litter' },
    { key: 'shaded', label: 'Under cover' },
  ],
  strider: [{ key: 'open', label: 'Lake shallows' }],
  glider: [{ key: 'open', label: 'Woodland edge' }],
}
// The World's own colours (visualStudyWorlds.ts, the island's palette): ground, water, plants, shade.
const W_GROUND = '#D7C29B'
const W_TEAL = '#3E7A7B'
const W_MOSS = '#4E5F45'
const W_SHADE = '#6C6499'
const STATE_COLOUR: Record<string, string> = { rest: 'rgba(233,230,223,0.5)', travel: '#F2E4C4', forage: '#FF1F1F', return: '#F2E4C4' }

export function CreaturesInspection() {
  const [species, setSpecies] = useState<SpeciesId>('dweller')
  const age = 0.8
  const [hour, setHour] = useState(15.5)
  const [groundAsked, setGround] = useState<'open' | 'shaded'>('shaded')
  // (A species with one habitat has one ground: the choice applies only where there are two.)
  const ground = CONTEXTS[species].some((c) => c.key === groundAsked) ? groundAsked : CONTEXTS[species][0]!.key
  const state = stateAt(species, hour, ground)
  const [hover, setHover] = useState<number | null>(null)
  const info = SPECIES[species]
  const motion = motionFor(species, state)
  const [wrap, width] = useWidth(1120 - 320)
  const W = width
  const H = 300
  const d = daylight(hour)
  const sunOnGround = ground === 'shaded' ? d * 0.15 : d

  // The live rig: built once per species, run every frame in the state's motion, its bones read and drawn from the side.
  const canvas = useRef<HTMLCanvasElement>(null)
  const hoverRef = useRef<number | null>(null)
  hoverRef.current = hover
  const scene = useRef({ ground, sun: sunOnGround, day: d, species })
  scene.current = { ground, sun: sunOnGround, day: d, species }
  useEffect(() => {
    const c = BUILD[species]({ seed: 7, age, condition: 0.75, mineral: 0.6, habitat: 0.5 })
    const bones = c.skeleton.bones
    const index = new Map(bones.map((b, i) => [b, i]))
    const parent = bones.map((b) => (b.parent ? (index.get(b.parent as never) ?? -1) : -1))
    const v = new Vector3()
    c.root.updateMatrixWorld(true)
    const rest = bones.map((b) => b.getWorldPosition(new Vector3()))
    const spread = (k: 'x' | 'z') => Math.max(...rest.map((p) => p[k])) - Math.min(...rest.map((p) => p[k]))
    const across: 'x' | 'z' = spread('x') >= spread('z') ? 'x' : 'z'
    const x0 = Math.min(...rest.map((p) => p[across]))
    const x1 = Math.max(...rest.map((p) => p[across]))
    const yTop = Math.max(...rest.map((p) => p.y))
    const k = Math.min((W * 0.6) / Math.max(0.2, x1 - x0, c.size.length, c.size.span), (H - 110) / Math.max(0.2, yTop))
    const cx = (x0 + x1) / 2
    const groundY = H - 46
    const X = (x: number) => W / 2 + (x - cx) * k
    const Y = (y: number) => groundY - y * k
    let raf = 0
    let last = performance.now()
    const follow = { x: 0, lift: 0, y: 0, ready: false }
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      c.update(dt, { motion, pace: 1, bank: 20 })
      c.root.updateMatrixWorld(true)
      const el = canvas.current
      if (!el) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (el.width !== W * dpr || el.height !== H * dpr) {
        el.width = W * dpr
        el.height = H * dpr
      }
      const g = el.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, W, H)
      const env = scene.current
      // ITS HABITAT, in the World's colours. The sky's light as strong as the hour makes it; then what is over or around it where it lives: its
      // structure's overhang (Dweller), a canopy over the litter (Crawler), trees at the woodland edge (Glider); the Strider stands in water.
      g.fillStyle = `rgba(242, 228, 196, ${(0.03 + env.day * 0.1).toFixed(3)})`
      g.fillRect(0, 0, W, groundY)
      const sp = env.species
      if (env.ground === 'shaded' && sp === 'dweller') {
        g.globalAlpha = 0.35
        g.fillStyle = W_SHADE
        g.fillRect(W * 0.1, 24, W * 0.8, groundY - 24)
        g.globalAlpha = 1
        g.fillStyle = W_GROUND
        g.fillRect(W * 0.06, 16, W * 0.88, 9)
        g.fillRect(W * 0.08, 24, 7, groundY - 24)
        g.fillRect(W * 0.9 - 7, 24, 7, groundY - 24)
      } else if (env.ground === 'shaded' && sp === 'crawler') {
        g.globalAlpha = 0.35
        g.fillStyle = W_SHADE
        g.fillRect(0, 40, W, groundY - 40)
        g.globalAlpha = 0.9
        g.fillStyle = W_MOSS
        for (let i = 0; i < 7; i += 1) {
          g.beginPath()
          g.ellipse((i + 0.5) * (W / 7), 34 + (i % 2) * 10, W / 9, 26, 0, 0, Math.PI * 2)
          g.fill()
        }
        g.globalAlpha = 1
      } else if (sp === 'glider') {
        g.fillStyle = W_MOSS
        for (const x of [0.06, 0.16, 0.86, 0.95]) {
          g.fillRect(W * x - 2, groundY - 120, 4, 120)
          g.beginPath()
          g.ellipse(W * x, groundY - 130, 34, 46, 0, 0, Math.PI * 2)
          g.fill()
        }
      }
      if (env.day > 0.05 && !(env.ground === 'shaded')) {
        g.fillStyle = `rgba(242, 228, 196, ${(0.3 + env.day * 0.6).toFixed(2)})`
        g.beginPath()
        g.arc(W - 46, 40, 12, 0, Math.PI * 2)
        g.fill()
      }
      // The ground: litter or soil in the island's sandstone; for the Strider the lake bed under 0.3 m of water.
      g.fillStyle = sp === 'strider' ? 'rgba(31, 77, 82, 0.9)' : 'rgba(215, 194, 155, 0.22)'
      g.fillRect(0, groundY, W, H - groundY)
      if (sp === 'strider') {
        g.globalAlpha = 0.55
        g.fillStyle = W_TEAL
        g.fillRect(0, Y(0.3), W, groundY - Y(0.3))
        g.globalAlpha = 1
      }
      g.strokeStyle = 'rgba(215, 194, 155, 0.7)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(0, groundY)
      g.lineTo(W, groundY)
      g.stroke()
      g.fillStyle = INK.mute
      g.font = '10px ui-monospace, monospace'
      g.fillText(`SUN ON ITS GROUND ${Math.round(env.sun * 100)}%`, 12, H - 18)
      const raw = bones.map((b) => {
        b.getWorldPosition(v)
        return [X(v[across]), Y(v.y)] as [number, number]
      })
      const xs = raw.map((p) => p[0])
      const ys = raw.map((p) => p[1])
      const midX = (Math.min(...xs) + Math.max(...xs)) / 2
      const bottom = Math.max(...ys)
      const top = Math.min(...ys)
      const wantX = W / 2 - midX
      // A walker stands ON its ground: its lowest bone is lifted back to the ground line whenever the motion drops it below (as the island lifts
      // its animals by their pose: Creatures.tsx, grounding). A flier is held mid-air.
      const wantY = species === 'glider' ? (groundY - 90) - (top + bottom) / 2 : Math.min(0, groundY - bottom)
      if (!follow.ready) {
        follow.x = wantX
        follow.y = wantY
        follow.ready = true
      } else {
        follow.x += (wantX - follow.x) * 0.12
        // (Up at once, never through the ground; down gently.)
        follow.y = wantY < follow.y ? wantY : follow.y + (wantY - follow.y) * 0.12
      }
      const at = raw.map(([x, y]) => [x + follow.x, y + follow.y] as [number, number])
      bones.forEach((_, i) => {
        const p = parent[i]!
        if (p < 0) return
        g.strokeStyle = 'rgba(243, 239, 229, 0.9)'
        g.lineWidth = 1.6
        g.beginPath()
        g.moveTo(at[p]![0], at[p]![1])
        g.lineTo(at[i]![0], at[i]![1])
        g.stroke()
      })
      const h = hoverRef.current
      at.forEach(([x, y], i) => {
        g.fillStyle = i === h || parent[i]! < 0 ? INK.signal : INK.line
        g.beginPath()
        g.arc(x, y, i === h ? 4.5 : 2.2, 0, Math.PI * 2)
        g.fill()
      })
      if (h !== null && bones[h]) {
        g.fillStyle = INK.line
        g.font = '11px ui-monospace, monospace'
        g.fillText(bones[h]!.name, Math.min(W - 120, at[h]![0] + 8), Math.max(14, at[h]![1] - 8))
      }
      ;(el as HTMLCanvasElement & { __joints?: [number, number][] }).__joints = at
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      c.dispose()
    }
  }, [species, motion, W])

  const chosen = STATES.find((x) => x.key === state)!
  const motionInfo = info.motions.find((m) => m.id === motion)
  const other = stateAt(species, hour, ground === 'open' ? 'shaded' : 'open')
  return (
    <Exhibit
      controls={
        <>
          <Seg label="Species" items={ORDER.map((x) => ({ key: x, label: SPECIES[x].label }))} value={species} onChange={setSpecies} />
          {CONTEXTS[species].length > 1 ? <Seg label="Its ground" items={CONTEXTS[species]} value={ground} onChange={setGround} /> : <span className="pv-ex-context">{CONTEXTS[species][0]!.label}</span>}
        </>
      }
      stage={
        <div ref={wrap} className="pv-ex-fill">
          <div className="pv-ex-state" style={{ borderColor: STATE_COLOUR[state] }}>
            <b>{chosen.label}</b> · {(motionInfo?.label ?? motion).toLowerCase()} · {formatHour(hour)}
          </div>
          <canvas
            ref={canvas}
            className="pv-an-canvas"
            style={{ width: W, height: H }}
            aria-label={`${info.label}'s rig from the side, ${chosen.label.toLowerCase()}`}
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              const mx = e.clientX - r.left
              const my = e.clientY - r.top
              const joints = (e.currentTarget as HTMLCanvasElement & { __joints?: [number, number][] }).__joints ?? []
              let best = { dd: 14, i: -1 }
              joints.forEach(([x, y], i) => {
                const dd = Math.hypot(x - mx, y - my)
                if (dd < best.dd) best = { dd, i }
              })
              setHover(best.i >= 0 ? best.i : null)
            }}
            onPointerLeave={() => setHover(null)}
          />
          <p className="pv-ex-aside-k">Its day · click to choose the hour</p>
          <DayStrip species={species} hour={hour} ground={ground} onHour={setHour} width={W} />
        </div>
      }
      legend={
        <>
          <Key swatch="rgba(242,228,196,0.6)">daylight over 24 h</Key>
          <Key line="dash #FF1F1F">its threshold</Key>
          <Key swatch={INK.signal}>active</Key>
          <Key swatch="rgba(233,230,223,0.3)">resting</Key>
        </>
      }
      aside={
        <>
          <p className="pv-ex-aside-k">{info.label}</p>
          <p className="pv-ex-aside-say">{PREFERS[species]}.</p>
          <dl className="pv-an-mini-readout">
            <div>
              <dt>{CONTEXTS[species].length > 1 ? (ground === 'open' ? CONTEXTS[species][1]!.label : CONTEXTS[species][0]!.label) : 'Shade'}</dt>
              <dd>{CONTEXTS[species].length < 2 ? 'plays no part in what it does' : other === state ? 'the same at this hour' : `it would ${STATES.find((x) => x.key === other)!.label.toLowerCase()}`}</dd>
            </div>
          </dl>
        </>
      }
      chain={{
        input: <>At {formatHour(hour)}: daylight {Math.round(d * 100)}%{CONTEXTS[species].length > 1 ? <>; on its ground {Math.round(sunOnGround * 100)}%{ground === 'shaded' ? (species === 'dweller' ? ', its structure keeping most of the sun off' : ', the cover keeping most of the sun off') : ''}</> : ''}.</>,
        rule: species === 'dweller' ? 'Above 45% daylight it is day: it keeps to shade, and moves into it if the sun reaches its place.' : species === 'crawler' ? 'It reads the sun on its own ground: under 35% it feeds, over 45% it curls up.' : species === 'strider' ? 'Above 15% daylight it works the shallows.' : 'Under 12% daylight it roosts.',
        result: <>{chosen.label}: {why(species, hour, ground)}</>,
      }}
    />
  )
}
