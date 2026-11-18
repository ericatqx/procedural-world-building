import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BufferGeometry, DynamicDrawUsage, Line as ThreeLine, LineBasicMaterial, Matrix4, SkeletonHelper, Vector3, type Group, type InstancedMesh, type Mesh } from 'three'
import { AUTO_ROTATE_SPEED, ControlField, Disclosure, ExerciseHeading, InstrumentPanel, PanelSection, Segmented, Slider, ViewTools, type ExerciseAbout } from '../shared/ui/instrument.tsx'
import { buildCrawler } from './crawler.ts'
import { buildDweller } from './dweller.ts'
import { buildGlider } from './glider.ts'
import { stageName } from './growth.ts'
import { buildStrider } from './strider.ts'
import { brainFor } from './agent/brains.ts'
import { ARENAS, newHazard, pickTarget, senseEnv, spawnHazard, steer, stepHazard, type Arena, type Hazard, type Pose, type Target } from './agent/space.ts'
import { DEFAULT_ENV, ENV_FIELDS, type BrainDebug, type Env, type EnvKey } from './agent/types.ts'
import { SPECIES, SPECIES_IDS } from './species.ts'
import { AXES, type TraitReading } from './traits.ts'
import type { BodyPlan, Creature, CreatureParams, Frame, MotionId, MotionInput, SpeciesId } from './types.ts'
import { HOURS, LabGround, LOOKS, StudioLight, WorldLight, type Hour, type Look } from '../shared/labLook.tsx'
import { asOnIsland } from '../project03/worldMaterials.ts'
import { arenaClock } from './agent/space.ts'
import '../shared/ui/system.css'
import './clab.css'

const ABOUT: ExerciseAbout = {
  text: 'The island’s four creatures, generated: each is built from a seed on a skeleton, in metres, with soft tissue and mineral as separate skins, and moves by procedural animation (legs solved to the ground every frame, a stride taken from the leg). Three layers make an individual: its species’ BODY PLAN, the TRAITS its seed gives it (a few linked axes), and what its LIFE and HABITAT have done (age, condition, mineral, place). Anatomy plays the motions by hand; Behaviour lets the agent choose them (needs, a behaviour tree and a state machine), with the same daily rhythms the island’s creatures keep. The World look draws them as the island does.',
  terms: 'skeleton · skinning · digitigrade · inverse kinematics · stance and swing · fan wing · calcification · tergite · metachronal wave · bank angle',
  controls: 'R auto rotate · F wireframe · K skeleton · G scale reference · drag orbit · scroll zoom',
}

const BASE: CreatureParams = { seed: 7, age: 0.7, condition: 0.7, mineral: 0.55, habitat: 0.5 }
const BUILD: Record<SpeciesId, (p: CreatureParams) => Creature> = { dweller: buildDweller, glider: buildGlider, strider: buildStrider, crawler: buildCrawler }
/** What each test arena offers. */
const ARENA_NOTE: Record<ArenaSpecies, string> = {
  dweller: 'Two shelters, a patch of damp shade with fungi and seed on the floor, and a second food patch in the open. By day the Dweller lies up in a shelter; at dusk and night it goes out to the food, eats until fed, and returns. A threat sends it to cover.',
  strider: 'A pool, deep in the middle, with shallows around it and food in two patches in the shallows. The Strider walks the shore, wades and forages in the shallows, and swims in the deep.',
  crawler: 'Open ground in the sun with two shaded patches of litter. The Crawler feeds in the litter, keeps to the shade, and rolls up if threatened.',
}
const FIRST_MOTION: Record<SpeciesId, MotionId> = { dweller: 'idle', glider: 'perch', strider: 'stand', crawler: 'idle' }
const WALKING: MotionId[] = ['walk', 'run', 'wade', 'swim', 'scuttle']
const PERSON = 1.75
/** Left to right in the line-up: smallest first, so the person at the left is the scale. */
const LINE: { id: SpeciesId; x: number }[] = [
  { id: 'crawler', x: -4.3 },
  { id: 'dweller', x: -2.3 },
  { id: 'strider', x: 0.1 },
  { id: 'glider', x: 2.9 },
]

type SpatialDebug = { goal: string; mode: string; target: string; dist: number; speed: number; x: number; z: number; env: Env }
type Readout = { frame: Frame; ms: number; fps: number; slip: number; brain?: BrainDebug; spatial?: SpatialDebug }
type ArenaSpecies = 'dweller' | 'strider' | 'crawler'
const hasArena = (s: SpeciesId): s is ArenaSpecies => s !== 'glider'
const WALKERS: MotionId[] = ['walk', 'run', 'wade', 'scuttle']
const AT_REST: Record<ArenaSpecies, MotionId> = { dweller: 'idle', strider: 'stand', crawler: 'idle' }

/** What the lab remembers while it is closed: the project shows one page at a time, so leaving the Creature Lab unmounts it. */
const memory: Record<string, unknown> = {}
function useRemembered<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => (key in memory ? (memory[key] as T) : initial))
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        memory[key] = v
        return v
      })
    },
    [key],
  )
  return [value, set] as const
}

/** Ground markers that move past the creature, so walking and gliding read against something fixed to the world. */
function Ground({ species, world, lattice, props, children }: { species: SpeciesId; world: React.RefObject<Group | null>; lattice: React.RefObject<Group | null>; props: React.RefObject<Group | null>; children?: ReactNode }) {
  const { spacing, extent, dot } = SPECIES[species].ground
  const mesh = useRef<InstancedMesh>(null)
  const n = Math.floor((extent * 2) / spacing) + 1
  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const mat = new Matrix4()
    let i = 0
    for (let a = 0; a < n; a += 1) {
      for (let b = 0; b < n; b += 1) {
        mat.makeTranslation(-extent + a * spacing, 0.0015, -extent + b * spacing)
        m.setMatrixAt(i, mat)
        i += 1
      }
    }
    m.instanceMatrix.setUsage(DynamicDrawUsage)
    m.instanceMatrix.needsUpdate = true
  }, [n, extent, spacing])
  return (
    <group ref={world}>
      <group ref={lattice}>
        <instancedMesh key={`${species}-${n}`} ref={mesh} args={[undefined, undefined, n * n]} frustumCulled={false} receiveShadow>
          <cylinderGeometry args={[dot, dot, dot * 0.2, 10]} />
          <meshStandardMaterial color="#6f6b60" roughness={1} />
        </instancedMesh>
      </group>
      <group ref={props}>
        {species === 'glider' ? (
          <group>
            <mesh position={[0.04, 1.13, -0.05]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.03, 0.026, 1.2, 12]} />
              <meshStandardMaterial color="#8d887b" roughness={0.95} />
            </mesh>
            <mesh position={[0.04, 0.57, -0.62]} castShadow receiveShadow>
              <boxGeometry args={[0.16, 1.14, 0.16]} />
              <meshStandardMaterial color="#77736a" roughness={1} />
            </mesh>
          </group>
        ) : null}
        {children}
      </group>
    </group>
  )
}

/** How the stage is lit and drawn: the island's look (World, at an hour) or the neutral Studio. */
const LookCtx = createContext<{ look: Look; hour: Hour }>({ look: 'world', hour: 'day' })

function Lights({ reach, centre }: { reach: number; centre?: [number, number, number] }) {
  const { look, hour } = useContext(LookCtx)
  if (look === 'world') {
    return (
      <>
        <WorldLight hour={hour} reach={reach} centre={centre} />
        <LabGround look="world" radius={Math.max(4, reach * 4)} />
      </>
    )
  }
  return (
    <>
      <StudioLight reach={reach} />
      <LabGround look="studio" radius={200} />
    </>
  )
}

function skeletonHelper(root: Group) {
  const h = new SkeletonHelper(root)
  const m = h.material as unknown as { depthTest: boolean; transparent: boolean; opacity: number; color: { set: (c: string) => void } }
  m.depthTest = false
  m.transparent = true
  m.opacity = 0.9
  m.color.set('#e8ff6a')
  h.renderOrder = 10
  return h
}

/** The scene for one species: the creature fixed at the origin, the ground drawn past it. */
function Stage({ creature, species, motion, pace, bank, auto, spatial, hazardTick, resetTick, envRef, shelter, skeleton, wireframe, reference, onFrame }: { creature: Creature; species: SpeciesId; motion: MotionId; pace: number; bank: number; auto: boolean; spatial: boolean; hazardTick: number; resetTick: number; envRef: { current: Env }; shelter: boolean; skeleton: boolean; wireframe: boolean; reference: boolean; onFrame: (r: Readout) => void }) {
  const world = useRef<Group>(null)
  const lattice = useRef<Group>(null)
  const props = useRef<Group>(null)
  const input = useRef<MotionInput>({ motion, pace, bank })
  const autoRef = useRef(auto)
  // One agent per species; switching Auto Behavior on starts it fresh.
  const brain = useMemo(() => brainFor(species), [species])
  useEffect(() => {
    autoRef.current = auto
    if (auto) brain.reset()
  }, [auto, brain])
  useEffect(() => {
    input.current = { motion, pace, bank }
  }, [motion, pace, bank])
  const pose = useRef({ x: 0, z: 0, rot: 0 })
  const water = useRef<Mesh>(null)
  const info = SPECIES[species]
  // The spatial test arena: where the agent stands in it is the pose of the world around the creature, which stays at the origin.
  const arena: Arena | null = hasArena(species) ? ARENAS[species] : null
  const sim = useRef({ hazard: newHazard(), steer: { t: 0, seed: 7 }, aim: null as Target | null, agent: { x: 0, z: 0, heading: 0 } as Pose })
  const spatialRef = useRef(spatial)
  useEffect(() => {
    spatialRef.current = spatial
  }, [spatial])
  // Put the agent at the arena's start whenever the arena is entered or reset.
  useEffect(() => {
    if (!spatial || !arena) return
    const st = arena.start
    const p = pose.current
    const cr = Math.cos(st.heading)
    const sr = Math.sin(st.heading)
    p.rot = st.heading
    p.x = -(st.x * cr + st.z * sr)
    p.z = -(-st.x * sr + st.z * cr)
    sim.current.hazard = newHazard()
    brain.reset()
  }, [spatial, arena, resetTick, brain])
  useEffect(() => {
    if (hazardTick > 0 && arena) spawnHazard(sim.current.hazard, arena, sim.current.agent)
  }, [hazardTick, arena])

  const helper = useMemo(() => skeletonHelper(creature.root), [creature])
  useEffect(() => () => helper.dispose(), [helper])
  useEffect(() => creature.setWireframe(wireframe), [creature, wireframe])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const t0 = performance.now()
    const p = pose.current
    // Manual: the controls drive the body. Auto: the agent reads the environment (sliders, or what it senses in the arena) and drives it.
    let inp: MotionInput = input.current
    let debug: BrainDebug | undefined
    let spatialDebug: SpatialDebug | undefined
    let agentTurn = 0
    const arenaOn = autoRef.current && spatialRef.current && arena !== null
    if (autoRef.current) {
      let env = envRef.current
      let agent: Pose | null = null
      if (arenaOn && arena) {
        const cr = Math.cos(p.rot)
        const sr = Math.sin(p.rot)
        agent = { x: -p.x * cr + p.z * sr, z: -p.x * sr - p.z * cr, heading: p.rot }
        sim.current.agent = agent
        stepHazard(sim.current.hazard, arena, agent, dt)
        env = senseEnv(arena, agent, sim.current.hazard)
      }
      const r = brain.update(dt, env)
      let motionNow = r.intent.motion
      let paceNow = r.intent.pace
      if (arenaOn && arena && agent && hasArena(species)) {
        // Perceive, pick a target for the goal the tree set, steer toward it; the speed it can keep decides how it moves.
        const aim = pickTarget(arena, agent, r.intent.goal, sim.current.hazard)
        const st = steer(arena, agent, r.intent.goal, aim, sim.current.hazard, sim.current.steer, dt)
        sim.current.aim = aim
        if (WALKERS.includes(motionNow)) {
          if (st.speed < 0.08) motionNow = AT_REST[species]
          else paceNow = Math.min(1.6, Math.max(0.3, paceNow * (0.3 + 0.7 * st.speed)))
        } else if (motionNow === 'swim' && st.speed < 0.08) paceNow = 0.3
        agentTurn = st.turn * (st.speed > 0.08 ? 1 : 0.35)
        spatialDebug = { goal: r.intent.goal, mode: st.mode, target: aim ? aim.kind : 'none in range', dist: aim ? aim.dist : 0, speed: st.speed, x: agent.x, z: agent.z, env }
      }
      inp = { motion: motionNow, pace: paceNow, bank: r.intent.bank, water: r.intent.water, feed: r.intent.feed }
      debug = r.debug
    }
    const frame = creature.update(dt, inp)
    const ms = performance.now() - t0
    if (inp.motion === 'perch') {
      // A perch is still: the bar stands under the feet again.
      p.x = 0
      p.z = 0
      p.rot = 0
    }
    // The world moves past the creature: it turns about it and slides back along its heading.
    const turn = (frame.yawRate + agentTurn) * dt
    const c = Math.cos(turn)
    const s = Math.sin(turn)
    const nx = p.x * c + p.z * s - frame.speed * dt
    const nz = -p.x * s + p.z * c
    p.x = nx
    p.z = nz
    p.rot += turn
    props.current?.position.set(p.x, 0, p.z)
    if (props.current) props.current.rotation.y = p.rot
    // The markers repeat every `spacing`, so the lattice is kept to the cell under the creature.
    const cr = Math.cos(p.rot)
    const sr = Math.sin(p.rot)
    const gx = -p.x * cr + p.z * sr
    const gz = -p.x * sr - p.z * cr
    const sp = info.ground.spacing
    const wx = gx - Math.round(gx / sp) * sp
    const wz = gz - Math.round(gz / sp) * sp
    if (lattice.current) {
      lattice.current.position.set(-(wx * cr + wz * sr), 0, -(-wx * sr + wz * cr))
      lattice.current.rotation.y = p.rot
    }
    if (water.current && frame.water !== undefined) {
      water.current.position.y = frame.water
      // In the arena the water is local to the creature: it shows only where it stands in water, and not across the whole ground.
      water.current.visible = !arenaOn || frame.water > 0.03
      water.current.scale.setScalar(arenaOn ? 0.12 : 1)
    }
    onFrame({ frame, ms, fps: delta > 0 ? 1 / delta : 0, slip: frame.slip, brain: debug, spatial: spatialDebug })
  })

  return (
    <>
      <Lights reach={info.ground.shadow} centre={creature.frame.target} />
      <Ground species={species} world={world} lattice={lattice} props={props}>
        {spatial && arena && hasArena(species) ? <ArenaScene arena={arena} sim={sim} /> : null}
      </Ground>
      {creature.water !== undefined ? (
        <mesh ref={water} rotation={[-Math.PI / 2, 0, 0]} position={[0, creature.water, 0]}>
          <planeGeometry args={[80, 80]} />
          <meshStandardMaterial color="#5a8a96" transparent opacity={0.4} roughness={0.25} depthWrite={false} />
        </mesh>
      ) : null}
      {shelter ? <Shelter /> : null}
      <primitive object={creature.root} />
      {skeleton ? <primitive object={helper} /> : null}
      {reference ? <Reference species={species} /> : null}
    </>
  )
}

/** A low shelf of mineral, the kind of space the Dweller crouches to enter (a stand-in for Architecture). */
function Shelter() {
  return (
    <group>
      <mesh position={[0.2, 0.47, 0]} castShadow>
        <boxGeometry args={[2.6, 0.14, 1.5]} />
        <meshStandardMaterial color="#8d887b" roughness={0.95} transparent opacity={0.4} depthWrite={false} />
      </mesh>
      {[-0.7, 0.7].map((z) => (
        <mesh key={z} position={[0.2, 0.2, z]}>
          <boxGeometry args={[2.4, 0.4, 0.1]} />
          <meshStandardMaterial color="#77736a" roughness={1} transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

/** The test arena, drawn in the world around the creature: zones on the ground, the hazard, and what the agent is heading for. */
function ArenaScene({ arena, sim }: { arena: Arena; sim: { current: { hazard: Hazard; aim: Target | null; agent: Pose } } }) {
  const hazard = useRef<Group>(null)
  const ring = useRef<Mesh>(null)
  const line = useMemo(() => {
    const l = new ThreeLine(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]), new LineBasicMaterial({ color: '#e8ff6a', transparent: true, opacity: 0.55, depthTest: false }))
    l.frustumCulled = false
    l.renderOrder = 9
    return l
  }, [])
  useEffect(() => () => {
    line.geometry.dispose()
    ;(line.material as LineBasicMaterial).dispose()
  }, [line])
  const mark = Math.max(0.05, 0.45 * arena.unit)
  useFrame(() => {
    const { hazard: h, aim, agent } = sim.current
    if (hazard.current) {
      hazard.current.visible = h.active
      hazard.current.position.set(h.x, 0, h.z)
    }
    if (ring.current) {
      ring.current.visible = aim !== null
      if (aim) ring.current.position.set(aim.x, 0.006, aim.z)
    }
    line.visible = aim !== null
    if (aim) {
      const pos = line.geometry.attributes.position!
      pos.setXYZ(0, agent.x, 0.01, agent.z)
      pos.setXYZ(1, aim.x, 0.01, aim.z)
      pos.needsUpdate = true
    }
  })
  const disc = (x: number, z: number, r: number, color: string, opacity: number, y = 0.004, key?: string) => (
    <mesh key={key} position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[r, 48]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  )
  return (
    <group>
      <Line points={Array.from({ length: 65 }, (_, i) => [Math.cos((i / 64) * Math.PI * 2) * arena.radius, 0.003, Math.sin((i / 64) * Math.PI * 2) * arena.radius] as [number, number, number])} color="#4b4a44" lineWidth={1} />
      {arena.pool ? (
        <>
          {disc(arena.pool.x, arena.pool.z, arena.pool.r, '#4f7f8c', 0.38, 0.003, 'pool')}
          {disc(arena.pool.x, arena.pool.z, arena.pool.r * 0.55, '#3d6a78', 0.4, 0.0035, 'deep')}
          {disc(arena.pool.x, arena.pool.z, arena.pool.r * 0.25, '#2f5666', 0.45, 0.004, 'deeper')}
        </>
      ) : null}
      {arena.shade.map((z, i) => disc(z.x, z.z, z.r, '#000000', 0.5, 0.004, `shade${i}`))}
      {arena.food.map((z, i) => disc(z.x, z.z, z.r, '#b9ad86', 0.45, 0.005, `food${i}`))}
      {arena.shelters.map((z, i) => (
        <group key={`shelter${i}`} position={[z.x, 0, z.z]}>
          <mesh position={[0, 0.46, 0]} castShadow>
            <boxGeometry args={[z.r * 2.1, 0.12, z.r * 1.7]} />
            <meshStandardMaterial color="#8d887b" roughness={0.95} transparent opacity={0.55} depthWrite={false} />
          </mesh>
          {[-1, 1].map((k) => (
            <mesh key={k} position={[0, 0.2, k * z.r * 0.8]}>
              <boxGeometry args={[z.r * 1.9, 0.4, 0.1]} />
              <meshStandardMaterial color="#77736a" roughness={1} transparent opacity={0.55} depthWrite={false} />
            </mesh>
          ))}
        </group>
      ))}
      <group ref={hazard} visible={false}>
        <mesh position={[0, mark * 0.9, 0]}>
          <coneGeometry args={[mark * 0.6, mark * 1.8, 6]} />
          <meshStandardMaterial color="#b4523a" roughness={0.8} />
        </mesh>
        {disc(0, 0, arena.threatRange * 0.5, '#b4523a', 0.12, 0.005, 'reach')}
      </group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[mark * 0.5, mark * 0.62, 24]} />
        <meshBasicMaterial color="#e8ff6a" transparent opacity={0.9} depthTest={false} />
      </mesh>
      <primitive object={line} />
    </group>
  )
}

/** One axis as a short bar from its low word to its high word, with the individual's value marked. */
function TraitBars({ traits, compact }: { traits: TraitReading[]; compact?: boolean }) {
  return (
    <div className={compact ? 'trait-bars compact' : 'trait-bars'}>
      {traits.map((t) => (
        <div key={t.key} className="trait-row" title={`${t.label}: ${t.drives}`}>
          <span className="trait-label">{t.label}</span>
          <span className="trait-track">
            <i style={{ left: `${((t.value + 1) / 2) * 100}%` }} />
          </span>
          <span className="trait-word">{t.value < -0.33 ? t.low : t.value > 0.33 ? t.high : 'middle'}</span>
        </div>
      ))}
    </div>
  )
}

/** The Builder's base body plan controls, for the species whose generators read them. Multipliers on the species as designed. */
const PLAN: Partial<Record<SpeciesId, { key: keyof BodyPlan; label: string; min: number; max: number; tip: string }[]>> = {
  dweller: [
    { key: 'torso', label: 'Torso length', min: 0.75, max: 1.3, tip: 'Stretches the trunk between haunch and chest; the spine bones, the body profile and the scutes move with it, and the fore legs ride forward on the chest.' },
    { key: 'girth', label: 'Girth', min: 0.8, max: 1.3, tip: 'Depth and width of the body, limbs and tail.' },
    { key: 'leg', label: 'Leg length', min: 0.75, max: 1.3, tip: 'All four legs. The body rises or drops to stand on them, and the stride grows or shrinks with them.' },
    { key: 'knee', label: 'Knee position', min: 0.6, max: 1.6, tip: 'Moves the knee and elbow along the leg: a longer thigh or a longer shin. Each leg keeps its length, so the body keeps its height and the feet stay planted.' },
    { key: 'head', label: 'Head size', min: 0.8, max: 1.3, tip: 'Skull, muzzle, eyes and ear roots together.' },
    { key: 'tail', label: 'Tail length', min: 0.6, max: 1.4, tip: 'Length of each tail segment.' },
  ],
  strider: [
    { key: 'torso', label: 'Trunk length', min: 0.75, max: 1.3, tip: 'Stretches the body from tail root to head; the hips, the trunk bones and the planted feet move with it.' },
    { key: 'girth', label: 'Body depth', min: 0.8, max: 1.3, tip: 'Depth and width of the body.' },
    { key: 'leg', label: 'Leg length', min: 0.75, max: 1.3, tip: 'All four legs: the body stands higher and the stride lengthens.' },
    { key: 'knee', label: 'Knee position', min: 0.6, max: 1.6, tip: 'A longer thigh or a longer shank, each leg the same total length.' },
    { key: 'tail', label: 'Sail height', min: 0.6, max: 1.4, tip: 'Length of the dorsal rays.' },
  ],
  glider: [
    { key: 'wing', label: 'Wing span', min: 0.75, max: 1.3, tip: 'Arm and ray length. More wing for the same body lowers the wing loading: a slower glide and tighter turns.' },
    { key: 'chord', label: 'Wing breadth', min: 0.8, max: 1.2, tip: 'How far the rays fan back. Broad, low-aspect wings for slow flight among trees; narrow ones for fast, open air.' },
    { key: 'girth', label: 'Body weight', min: 0.8, max: 1.3, tip: 'Body depth and width. A heavier body loads the wing more: it glides faster and turns wider.' },
    { key: 'tail', label: 'Tail fan', min: 0.6, max: 1.4, tip: 'Length of the tail rays, which steer the banked turn.' },
    { key: 'head', label: 'Head size', min: 0.8, max: 1.3, tip: 'Skull and eyes together.' },
  ],
  crawler: [
    { key: 'bands', label: 'Shell bands', min: -3, max: 3, tip: 'Adds or removes whole plates of the shell. Each band is a joint: more bands, a longer shell that rolls into a rounder ball.' },
    { key: 'dome', label: 'Shell dome', min: 0.75, max: 1.3, tip: 'A low, flat shell for pushing through litter, or a high dome.' },
    { key: 'leg', label: 'Leg length', min: 0.75, max: 1.3, tip: 'All four legs. The body stands higher, and the stride lengthens with them, so the feet stay planted.' },
    { key: 'head', label: 'Snout', min: 0.8, max: 1.3, tip: 'Length of the rooting snout.' },
    { key: 'girth', label: 'Girth', min: 0.8, max: 1.3, tip: 'Width of the shell and body.' },
  ],
}

type Compare = 'seeds' | string
/** What the four individuals of the Individuals view are: four consecutive seeds, or one axis swept with the others held at the middle. */
function kinParams(params: CreatureParams, compare: Compare, species: SpeciesId): { p: CreatureParams; label: string }[] {
  if (compare === 'seeds' || !(AXES[species] ?? []).some((a) => a.key === compare)) return [0, 1, 2, 3].map((k) => ({ p: { ...params, seed: params.seed + k }, label: `seed ${params.seed + k}` }))
  const axis = AXES[species]!.find((a) => a.key === compare)!
  const hold = Object.fromEntries(AXES[species]!.map((a) => [a.key, 0]))
  return [-1, -1 / 3, 1 / 3, 1].map((v) => ({ p: { ...params, traits: { ...hold, [compare]: v } }, label: `${axis.label} ${v > 0 ? '+' : ''}${v.toFixed(2)}` }))
}

/** Four individuals of one species side by side, in a resting pose, each labelled with its axes and the walk its legs make. */
function Kin({ items, labels, skeleton, wireframe, motion }: { items: Creature[]; labels: string[]; skeleton: boolean; wireframe: boolean; motion: MotionId }) {
  const helpers = useMemo(() => items.map((c) => skeletonHelper(c.root)), [items])
  useEffect(() => () => helpers.forEach((h) => h.dispose()), [helpers])
  useEffect(() => {
    for (const c of items) c.setWireframe(wireframe)
  }, [items, wireframe])
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    for (const c of items) c.update(dt, { motion, pace: 1, bank: 30 })
  })
  const gap = Math.max(...items.map((c) => Math.max(c.size.length, c.size.span))) * 1.12
  return (
    <>
      <Lights reach={gap * 3} />
      {items.map((c, i) => {
        const x = (i - 1.5) * gap
        return (
          <group key={i}>
            <primitive object={c.root} position={[x, 0, 0]} />
            <Html position={[x, 0, gap * 0.3]} center zIndexRange={[0, 0]} style={{ transform: 'translateY(58%)' }}>
              <div className="kin-card">
                <span className="kin-name">{labels[i]}</span>
                {c.traits?.length ? <TraitBars traits={c.traits} compact /> : null}
                {c.gait ? <span className="kin-gait">{`leg ${c.gait.leg.toFixed(2)} m · stride ${c.gait.stride.toFixed(2)} m`}</span> : <span className="kin-gait">{c.stats.features.split(' · ').slice(1, 3).join(' · ')}</span>}
              </div>
            </Html>
          </group>
        )
      })}
      {skeleton ? helpers.map((h, i) => <primitive key={i} object={h} />) : null}
    </>
  )
}

/** All four species side by side at one scale, each in a resting pose. */
function LineUp({ items, skeleton, wireframe, reference }: { items: Record<SpeciesId, Creature>; skeleton: boolean; wireframe: boolean; reference: boolean }) {
  const helpers = useMemo(() => SPECIES_IDS.map((id) => skeletonHelper(items[id].root)), [items])
  useEffect(() => () => helpers.forEach((h) => h.dispose()), [helpers])
  useEffect(() => {
    for (const id of SPECIES_IDS) items[id].setWireframe(wireframe)
  }, [items, wireframe])
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    for (const id of SPECIES_IDS) items[id].update(dt, { motion: SPECIES[id].lineUp, pace: 1, bank: 30 })
  })
  return (
    <>
      <Lights reach={9} />
      {LINE.map(({ id, x }) => (
        <group key={id}>
          <primitive object={items[id].root} position={[x, 0, 0]} />
          <Html position={[x, 0.02, 0.9]} zIndexRange={[10, 0]}>
            <span className="ref-label">{SPECIES[id].label}</span>
          </Html>
        </group>
      ))}
      {skeleton ? helpers.map((h, i) => <primitive key={i} object={h} />) : null}
      {reference ? <Person x={-5.7} z={0.6} /> : null}
    </>
  )
}

function Person({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.78, 0]}>
        <capsuleGeometry args={[0.17, 1.0, 4, 12]} />
        <meshBasicMaterial color="#8c877b" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.63, 0]}>
        <sphereGeometry args={[0.1, 14, 10]} />
        <meshBasicMaterial color="#8c877b" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <Line points={[[0.42, 0, 0], [0.42, PERSON, 0]]} color="#8c877b" lineWidth={1} />
      {[0, 0.5, 1, 1.5].map((h) => (
        <Line key={h} points={[[0.42, h, 0], [0.5, h, 0]]} color="#8c877b" lineWidth={1} />
      ))}
      <Html position={[0.55, PERSON, 0]} zIndexRange={[10, 0]}>
        <span className="ref-label">1.75 m person</span>
      </Html>
    </group>
  )
}

/** A person for scale (for the larger species) or a ruler (for the small ones). */
function Reference({ species }: { species: SpeciesId }) {
  if (species === 'crawler') {
    return (
      <group position={[-0.05, 0, 0.16]}>
        <Line points={[[-0.05, 0.001, 0], [0.05, 0.001, 0]]} color="#8c877b" lineWidth={1} />
        {[-0.05, 0, 0.05].map((x) => (
          <Line key={x} points={[[x, 0.001, -0.004], [x, 0.001, 0.004]]} color="#8c877b" lineWidth={1} />
        ))}
        <Html position={[0, 0.006, 0.01]} zIndexRange={[10, 0]}>
          <span className="ref-label">10 cm</span>
        </Html>
      </group>
    )
  }
  return <Person x={species === 'glider' ? -0.6 : -0.3} z={species === 'glider' ? 2.6 : species === 'strider' ? 1.9 : 1.5} />
}

/**
 * THE AGENT, made readable. Four layers, top to bottom, as the agent runs them each frame:
 *   senses     what it takes in from where it is (the environment: sliders, or what it perceives in the arena)
 *   needs      slow internal quantities that rise and fall with what it does
 *   decision   the behaviour tree's verdict: which branch ran, what it wants, and why, in words
 *   state      the finite state machine: the state it is in, the states it can go to next (and the one it is heading for, if the tree
 *              wants a state it cannot reach in one step), and its last transitions with their reasons
 */
function AgentDebug({ debug, spatial, species }: { debug?: BrainDebug; spatial?: SpatialDebug; species: SpeciesId }) {
  if (!debug) return <p className="note">Waiting for the first decision.</p>
  const read = new Set(ENV_FIELDS[species].map((f) => f.key))
  const senses = (Object.keys(debug.senses) as EnvKey[]).filter((k) => read.has(k) || (spatial && (k === 'light' || k === 'shelter' || k === 'water' || k === 'food' || k === 'threat')))
  const states = Object.keys(debug.edges)
  const next = new Set(debug.edges[debug.state] ?? [])
  return (
    <div className="agent-debug" aria-live="polite">
      <div className="fsm" role="list" aria-label="State machine">
        {states.map((st) => (
          <span key={st} role="listitem" className={`fsm-state${st === debug.state ? ' is-now' : next.has(st) ? ' is-next' : ''}${debug.heading === st ? ' is-goal' : ''}`}>{st}</span>
        ))}
      </div>
      <p className="agent-state">
        <b>{debug.state}</b>
        <span>{debug.time.toFixed(0)} s</span>
        {debug.heading ? <span>{`heading for ${debug.heading}`}</span> : null}
      </p>
      <p className="agent-trace">{`goal: ${debug.goal ?? 'stay'}`}{spatial ? ` · target: ${spatial.target}${spatial.dist ? ` ${spatial.dist.toFixed(1)} m away` : ''} · ${spatial.mode}` : ''}</p>
      <p className="note"><b>Because</b> {debug.why}.</p>
      <p className="note"><b>Effect</b> {debug.effect.length ? debug.effect.join(', ') : 'its needs are steady'}.</p>
      <p className="agent-trace" title="The branch of the behaviour tree that decided, from its root">{debug.trace.join(' › ')}</p>
      <p className="agent-sub">Senses</p>
      {senses.map((k) => (
        <div key={k} className="agent-need">
          <span>{k === 'daylight' ? 'time of day' : k}</span>
          <i style={{ width: `${Math.round(debug.senses[k] * 100)}%` }} />
        </div>
      ))}
      <p className="agent-sub">Needs</p>
      {debug.needs.map(([name, v]) => (
        <div key={name} className="agent-need">
          <span>{name}</span>
          <i style={{ width: `${Math.round(v * 100)}%` }} />
        </div>
      ))}
      {debug.extra.map((e) => (
        <p key={e} className="agent-trace">{e}</p>
      ))}
      {debug.recent.length ? (
        <>
          <p className="agent-sub">Transitions</p>
          <ul className="agent-log">
            {debug.recent.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

/** Frames the individual once when it changes size or species (not as sliders move). */
function CameraRig({ frame, id, side }: { frame: Creature['frame']; id: string; side?: boolean }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null
  const latest = useRef(frame)
  useLayoutEffect(() => {
    latest.current = frame
  })
  useLayoutEffect(() => {
    const { target, distance } = latest.current
    // A row of individuals is read in profile, where proportions show: from the side, a little above.
    if (side) camera.position.set(target[0] + distance * 0.14, target[1] + distance * 0.16, target[2] + distance)
    else camera.position.set(target[0] + distance * 0.62, target[1] + distance * 0.24, target[2] + distance * 0.8)
    // The panel covers the right of the canvas, so the subject is framed a little left of centre.
    controls?.target.set(target[0] + distance * (side ? 0.12 : 0.14), target[1], target[2])
    controls?.update()
  }, [camera, controls, id])
  return null
}

const LINE_FRAME: Creature['frame'] = { target: [-0.6, 0.85, 0], distance: 10.5 }

const VIEW_NOTE: Record<'one' | 'agent' | 'kin' | 'line', string> = {
  one: 'Anatomy: its body plan, measured, and its motions played by hand (manual preview).',
  agent: 'Behaviour: the agent chooses its own motion from what it senses and needs. You set its surroundings; it decides.',
  kin: 'Variation: four individuals of one species at the same age and place: what the seed alone changes.',
  line: 'All four species at one scale, each in a resting pose.',
}
const dayWord = (d: number) => (d < 0.12 ? 'night' : d < 0.45 ? 'dusk' : d < 0.8 ? 'day' : 'full day')
/** Anatomy readout values: metres, except counts, speeds and ratios. */
const unitOf = (k: string, v: number) => (k.includes('bands') ? `${v}` : k.includes('speed') ? `${v.toFixed(1)} m/s` : k.includes('×') ? `${v.toFixed(2)}×` : `${v.toFixed(2)} m`)

export function CreatureLab({ tabs }: { tabs: ReactNode }) {
  // The project shows one page at a time, so leaving this page unmounts the lab; what is chosen here is kept in `memory`, so coming
  // back finds the same species, controls and mode (the creature itself starts again).
  const [species, setSpecies] = useRemembered<SpeciesId>('species', 'dweller')
  const [view, setView] = useRemembered<'one' | 'agent' | 'line' | 'kin'>('view', 'one')
  const [look, setLook] = useRemembered<Look>('look', 'world')
  const [hour, setHour] = useRemembered<Hour>('hour', 'day')
  const [compare, setCompare] = useRemembered<Compare>('compare', 'seeds')
  const [plans, setPlans] = useRemembered<Partial<Record<SpeciesId, BodyPlan>>>('plans', {})
  const [params, setParams] = useRemembered<CreatureParams>('params', BASE)
  const [motions, setMotions] = useRemembered<Record<SpeciesId, MotionId>>('motions', FIRST_MOTION)
  const [pace, setPace] = useRemembered('pace', 1)
  const [where, setWhere] = useRemembered<'arena' | 'sliders'>('where', 'arena')
  const [envs, setEnvs] = useRemembered('envs', DEFAULT_ENV)
  const envRef = useRef(envs.dweller)
  const [bank, setBank] = useRemembered('bank', 32)
  const [wireframe, setWireframe] = useRemembered('wireframe', false)
  const [skeleton, setSkeleton] = useRemembered('skeleton', false)
  const [reference, setReference] = useRemembered('reference', true)
  const [autoRotate, setAutoRotate] = useRemembered('autoRotate', false)
  const [hazardTick, setHazardTick] = useState(0)
  const [resetTick, setResetTick] = useState(0)
  const [readout, setReadout] = useState<Readout | null>(null)
  const latest = useRef<Readout | null>(null)
  const peakSlip = useRef(0)
  const frames = useRef({ ms: 0, fps: 0, n: 0 })

  const auto = view === 'agent'
  const info = SPECIES[species]
  const motion = motions[species]
  const plan = plans[species]
  const creature = useMemo(() => {
    const c = BUILD[species]({ ...params, plan })
    if (look === 'world') asOnIsland(c, species)
    return c
  }, [species, params, plan, look])
  useEffect(() => () => creature.dispose(), [creature])
  // The line-up builds all four from the same controls, only while it is shown.
  const items = useMemo(() => {
    if (view !== 'line') return null
    return Object.fromEntries(SPECIES_IDS.map((id) => {
      const c = BUILD[id](params)
      if (look === 'world') asOnIsland(c, id)
      return [id, c]
    })) as Record<SpeciesId, Creature>
  }, [view, params, look])
  useEffect(
    () => () => {
      if (items) SPECIES_IDS.forEach((id) => items[id].dispose())
    },
    [items],
  )
  // Individuals: four of the chosen species, only while shown.
  const kinSpec = useMemo(() => (view === 'kin' ? kinParams({ ...params, plan }, compare, species) : null), [view, params, compare, species, plan])
  const kin = useMemo(() => (kinSpec ? kinSpec.map((k) => {
    const c = BUILD[species](k.p)
    if (look === 'world') asOnIsland(c, species)
    return c
  }) : null), [kinSpec, species, look])
  useEffect(() => () => kin?.forEach((c) => c.dispose()), [kin])
  const kinFrame = useMemo<Creature['frame'] | null>(() => {
    if (!kin) return null
    const gap = Math.max(...kin.map((c) => Math.max(c.size.length, c.size.span))) * 1.12
    const h = Math.max(...kin.map((c) => c.frame.target[1]))
    return { target: [0, h * 0.8, 0], distance: gap * 5.2 }
  }, [kin])

  useEffect(() => {
    const id = window.setInterval(() => {
      const f = frames.current
      if (latest.current) setReadout({ ...latest.current, ms: f.n ? f.ms / f.n : 0, fps: f.n ? f.fps / f.n : 0, slip: peakSlip.current })
      frames.current = { ms: 0, fps: 0, n: 0 }
      peakSlip.current = 0
    }, 400)
    return () => window.clearInterval(id)
  }, [])

  const onFrame = (r: Readout) => {
    latest.current = r
    frames.current.ms += r.ms
    frames.current.fps += r.fps
    frames.current.n += 1
    if (r.slip > peakSlip.current) peakSlip.current = r.slip
  }
  const set = (patch: Partial<CreatureParams>) => setParams((p) => ({ ...p, ...patch }))
  const current = info.motions.find((m) => m.id === motion) ?? info.motions[0]!
  const controls = info.controls
  const env = envs[species]
  useEffect(() => {
    envRef.current = env
    arenaClock.daylight = env.daylight
  }, [env])
  const setEnv = (key: EnvKey, value: number) => setEnvs((e) => ({ ...e, [species]: { ...e[species], [key]: value } }))
  const spatial = auto && where === 'arena' && hasArena(species)
  // The overhead shelf is for manual Crouch; in the arena, the shelters are in the world.
  const shelter = species === 'dweller' && !auto && motion === 'crouch'
  const lineUp = view === 'line' && items
  const grouped = Boolean(lineUp || kin)
  const axes = AXES[species] ?? []
  const totalTriangles = items ? SPECIES_IDS.reduce((a, id) => a + items[id].stats.triangles, 0) : 0

  let sectionN = 0
  const next = () => String(++sectionN).padStart(2, '0')
  const planControls = PLAN[species] ?? []
  const setPlan = (key: keyof BodyPlan, v: number) => setPlans((ps) => ({ ...ps, [species]: { ...ps[species], [key]: v } }))

  return (
    <div className="app-shell ui-system clab">
      <div className="viz-stage">
        <div className="world-canvas-wrap">
          <LookCtx.Provider value={{ look, hour }}>
          <Canvas className="world-canvas" shadows camera={{ position: [3, 2, 4], fov: 38, near: 0.02, far: 400 }} gl={{ antialias: true }}>
            {kin && kinSpec ? (
              <Kin key={`kin-${species}`} items={kin} labels={kinSpec.map((k) => k.label)} skeleton={skeleton} wireframe={wireframe} motion={info.lineUp} />
            ) : lineUp ? (
              <LineUp key="line" items={items} skeleton={skeleton} wireframe={wireframe} reference={reference} />
            ) : (
              <Stage key={species} creature={creature} species={species} motion={motion} pace={pace} bank={bank} auto={auto} spatial={spatial} hazardTick={hazardTick} resetTick={resetTick} envRef={envRef} shelter={shelter} skeleton={skeleton} wireframe={wireframe} reference={reference} onFrame={onFrame} />
            )}
            <CameraRig frame={kinFrame ?? (lineUp ? LINE_FRAME : creature.frame)} id={kin ? `kin-${species}-${compare}` : lineUp ? 'line' : species} side={Boolean(kin)} />
            <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={0.08} maxDistance={40} maxPolarAngle={Math.PI * 0.495} autoRotate={autoRotate} autoRotateSpeed={AUTO_ROTATE_SPEED} />
          </Canvas>
          </LookCtx.Provider>
          <ViewTools
            tools={[
              { label: 'Auto rotate', key: 'R', on: autoRotate, onChange: setAutoRotate },
              { label: 'Wireframe', key: 'F', on: wireframe, onChange: setWireframe },
              { label: 'Skeleton', key: 'K', on: skeleton, onChange: setSkeleton },
              { label: 'Reference', key: 'G', on: reference, onChange: setReference },
            ]}
            actions={
              <div className="look-row">
                <Segmented label="Look" options={LOOKS} value={look} onChange={setLook} />
                {look === 'world' ? <Segmented label="Hour" options={HOURS} value={hour} onChange={setHour} /> : null}
              </div>
            }
          >
            {kin ? (
              <p className="readout" aria-live="polite">
                <span>{info.label} · four individuals</span>
                <span>{compare === 'seeds' ? 'four seeds' : `one axis swept: ${axes.find((a) => a.key === compare)?.label ?? ''}`}</span>
                <span>{kin.reduce((a, c) => a + c.stats.triangles, 0).toLocaleString()} triangles</span>
                <span>{kin.length * 2} draw calls</span>
              </p>
            ) : lineUp ? (
              <p className="readout" aria-live="polite">
                <span>Line-up</span>
                <span>{totalTriangles.toLocaleString()} triangles</span>
                <span>{SPECIES_IDS.length * 2} draw calls</span>
                <span>{SPECIES_IDS.reduce((a, id) => a + items[id].stats.bones, 0)} bones</span>
              </p>
            ) : (
              <>
                <p className="readout" aria-live="polite">
                  <span>{info.label}</span>
                  <span>{readout?.frame.state ?? current.label.toLowerCase()}</span>
                  {readout?.frame.notes.map(([k, v]) => (
                    <span key={k}>{`${k} ${v}`}</span>
                  ))}
                  {(species === 'dweller' || species === 'strider') && readout && WALKING.includes(motion) ? <span>{`foot slip ${(readout.slip * 100).toFixed(1)} cm/s`}</span> : null}
                </p>
                <p className="readout" aria-live="polite">
                  <span>{creature.stats.triangles.toLocaleString()} triangles</span>
                  <span>{creature.stats.drawCalls} draw calls</span>
                  <span>{creature.stats.bones} bones</span>
                  <span>build {creature.stats.buildMs.toFixed(0)} ms</span>
                  <span>update {(readout?.ms ?? 0).toFixed(2)} ms</span>
                  <span>{(readout?.fps ?? 0).toFixed(0)} fps</span>
                </p>
              </>
            )}
          </ViewTools>
        </div>
      </div>

      <div className="app-chrome">
        <div className="region-left">
          <ExerciseHeading title="Creature Lab" about={ABOUT} />
          {tabs}
        </div>

        <InstrumentPanel label="Creature">
          <PanelSection index={next()} title="Species" tip="Four species, one for each family. Each is a body plan first: skeleton, tissue and mineral, then motion and behaviour.">
            <div data-group>
              <div className="choice-grid" role="group" aria-label="Species">
                {SPECIES_IDS.map((id) => (
                  <button key={id} type="button" className="choice" aria-pressed={id === species} onClick={() => { setSpecies(id); if (view === 'line') setView('one') }}>
                    {SPECIES[id].label}
                  </button>
                ))}
              </div>
              <Segmented
                label="View"
                options={[{ value: 'one', label: 'Anatomy' }, { value: 'agent', label: 'Behaviour' }, { value: 'kin', label: 'Variation' }, { value: 'line', label: 'All four' }]}
                value={view}
                onChange={setView}
              />
              <p className="note">{VIEW_NOTE[view]}</p>
              {grouped ? null : (
                <Disclosure label={`${info.family}: anatomy, mineral, size`}>
                  <p className="note">{info.role}</p>
                  <p className="note"><b>Anatomy.</b> {info.anatomy}</p>
                  <p className="note"><b>Mineral.</b> {info.mineral}</p>
                  <p className="note"><b>Size.</b> {info.size}. {creature.size.span > 0 ? `This individual: ${creature.size.span.toFixed(2)} m across.` : `This individual: ${creature.size.length.toFixed(2)} m long.`}</p>
                </Disclosure>
              )}
            </div>
          </PanelSection>

          {kin ? (
            <PanelSection index={next()} title="Compare" tip="Four seeds show the spread a population has. Choosing an axis holds the others at the middle and sweeps that one from end to end, so you see exactly what it moves.">
              <div data-group>
                <Segmented label="Compare" options={[{ value: 'seeds', label: 'Seeds' }, ...axes.map((a) => ({ value: a.key, label: a.key[0]!.toUpperCase() + a.key.slice(1) }))]} value={axes.some((a) => a.key === compare) ? compare : 'seeds'} onChange={setCompare} />
                {axes.length ? (
                  <div className="axis-notes">
                    {axes.map((a) => (
                      <p key={a.key} className="note"><b>{a.label}</b> · {a.low} to {a.high}: {a.drives}.</p>
                    ))}
                  </div>
                ) : <p className="note">This species has no linked trait axes yet: its seeds differ in counts and small asymmetries.</p>}
              </div>
            </PanelSection>
          ) : null}

          {view !== 'one' || !planControls.length ? null : (
            <PanelSection index={next()} title="Body plan" tip="The species' base anatomy: what every individual is built from. Seeded traits and life act on top of it.">
              <div data-group>
                {planControls.map((c) => (
                  <ControlField key={c.key} label={c.label} value={c.key === 'bands' ? `${(plan?.bands ?? 0) > 0 ? '+' : ''}${Math.round(plan?.bands ?? 0)}` : `${((plan?.[c.key] ?? 1) * 100).toFixed(0)}%`} tip={c.tip}>
                    <Slider label={c.label} min={c.min} max={c.max} step={c.key === 'bands' ? 1 : 0.01} value={plan?.[c.key] ?? (c.key === 'bands' ? 0 : 1)} onChange={(v) => setPlan(c.key, v)} />
                  </ControlField>
                ))}
                {creature.anatomy ? (
                  <dl className="anatomy">
                    {creature.anatomy.map(([k, v]) => (
                      <div key={k}><dt>{k}</dt><dd>{unitOf(k, v)}</dd></div>
                    ))}
                    {creature.gait ? (
                      <>
                        <div><dt>stride</dt><dd>{creature.gait.stride.toFixed(2)} m</dd></div>
                        <div><dt>cadence</dt><dd>{creature.gait.cadence.toFixed(2)} /s</dd></div>
                      </>
                    ) : null}
                  </dl>
                ) : null}
                <p className="note">Each change rebuilds and re-skins the skeleton; legs are solved to the ground every frame and the stride follows the leg, so feet stay planted (foot slip is measured below the view).</p>
                <div className="note">
                  <button type="button" className="text-button" onClick={() => setSkeleton(!skeleton)}>{skeleton ? 'Hide skeleton' : 'Show skeleton'}</button>
                  {'  ·  '}
                  <button type="button" className="text-button" onClick={() => setMotions((m) => ({ ...m, [species]: (species === 'glider' ? 'glide' : WALKING.find((id) => info.motions.some((x) => x.id === id))) ?? m[species] }))}>{species === 'glider' ? 'Glide' : 'Walk'}</button>
                  {'  ·  '}
                  <button type="button" className="text-button" onClick={() => setPlans((ps) => ({ ...ps, [species]: {} }))}>Reset body plan</button>
                </div>
              </div>
            </PanelSection>
          )}

          {view !== 'one' ? null : (
            <PanelSection index={next()} title="Motion" tip="Manual preview: you choose the motion. Changing motion blends from one pose to the next. In Behaviour, the agent chooses.">
              <div data-group>
                <div className="choice-grid" role="group" aria-label="Motion">
                  {info.motions.map((m) => (
                    <button key={m.id} type="button" className="choice" aria-pressed={m.id === motion} onClick={() => setMotions((st) => ({ ...st, [species]: m.id }))}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="note">{current.note}</p>
                {WALKING.includes(motion) && controls.pace ? (
                  <ControlField label={controls.pace.label} value={`${pace.toFixed(2)}×`} tip={controls.pace.tip}>
                    <Slider label={controls.pace.label} min={0.3} max={1.5} step={0.05} value={pace} onChange={setPace} />
                  </ControlField>
                ) : null}
                {motion === 'bank' && controls.bank ? (
                  <ControlField label={controls.bank.label} value={`${bank}°`} tip={controls.bank.tip}>
                    <Slider label={controls.bank.label} min={10} max={55} step={1} value={bank} onChange={setBank} />
                  </ControlField>
                ) : null}
              </div>
            </PanelSection>
          )}

          {view !== 'agent' ? null : (
            <PanelSection index={next()} title="Surroundings" tip="What the agent can sense. The island's creatures read the same things from the island: daylight from the sky, light and shelter from Living Architecture's shade and roofs, water from the lakes, food from the plants drawn there.">
              <div data-group>
                {hasArena(species) ? (
                  <Segmented label="Environment" options={[{ value: 'arena', label: 'Test arena' }, { value: 'sliders', label: 'Sliders' }]} value={where} onChange={setWhere} />
                ) : null}
                {ENV_FIELDS[species].filter((f) => !spatial || f.key === 'daylight').map((f) => (
                  <ControlField key={f.key} label={f.label} value={f.key === 'daylight' ? dayWord(env.daylight) : env[f.key].toFixed(2)} tip={f.tip}>
                    <Slider label={f.label} min={0} max={1} step={0.01} value={env[f.key]} onChange={(v) => setEnv(f.key, v)} />
                  </ControlField>
                ))}
                {spatial ? <p className="note">{ARENA_NOTE[species as ArenaSpecies]}</p> : null}
                <div className="note">
                  {spatial ? (
                    <>
                      <button type="button" className="text-button" onClick={() => setHazardTick((n) => n + 1)}>Send a threat</button>
                      {'  ·  '}
                      <button type="button" className="text-button" onClick={() => setResetTick((n) => n + 1)}>Reset arena</button>
                    </>
                  ) : (
                    <button type="button" className="text-button" onClick={() => setEnvs((e) => ({ ...e, [species]: DEFAULT_ENV[species] }))}>Reset surroundings</button>
                  )}
                </div>
              </div>
            </PanelSection>
          )}

          {view !== 'agent' ? null : (
            <PanelSection index={next()} title="Decision" tip="Read top to bottom: the states it can be in (the current one filled, the ones it can go to next outlined), why it is in this one, the branch of its behaviour tree that decided, what it senses, its needs, and its last transitions.">
              <AgentDebug debug={readout?.brain} spatial={spatial ? readout?.spatial : undefined} species={species} />
            </PanelSection>
          )}

          <PanelSection index={next()} title="Individual" tip="Seed: what this individual was born with (its linked traits, counts, small asymmetries). Life and habitat: what its life and place have done to it.">
            <div data-group>
              <ControlField label="Seed" value={`${params.seed}`}>
                <Slider label="Seed" min={1} max={99} step={1} value={params.seed} onChange={(v) => set({ seed: v })} />
              </ControlField>
              {grouped || !creature.traits?.length ? null : <TraitBars traits={creature.traits} />}
              <ControlField label="Age" value={`${params.age.toFixed(2)} · ${stageName(params.age)}`} tip={controls.age?.tip}>
                <Slider label="Age" min={0.1} max={1} step={0.01} value={params.age} onChange={(v) => set({ age: v })} />
              </ControlField>
              <Disclosure label="Condition, mineral, habitat">
                <ControlField label="Condition" value={params.condition.toFixed(2)} tip={controls.condition?.tip}>
                  <Slider label="Condition" min={0} max={1} step={0.01} value={params.condition} onChange={(v) => set({ condition: v })} />
                </ControlField>
                <ControlField label="Mineral" value={params.mineral.toFixed(2)} tip={controls.mineral?.tip}>
                  <Slider label="Mineral" min={0} max={1} step={0.01} value={params.mineral} onChange={(v) => set({ mineral: v })} />
                </ControlField>
                <ControlField label={lineUp ? 'Habitat' : controls.habitat?.label ?? 'Habitat'} value={params.habitat.toFixed(2)} tip={lineUp ? 'Hollow depth for the Dweller, wind for the Glider, water depth for the Strider, litter depth for the Crawler.' : controls.habitat?.tip}>
                  <Slider label="Habitat" min={0} max={1} step={0.01} value={params.habitat} onChange={(v) => set({ habitat: v })} />
                </ControlField>
              </Disclosure>
              {grouped ? null : <p className="note">{creature.stats.features}</p>}
              <div className="note">
                <button type="button" className="text-button" onClick={() => setParams(BASE)}>Reset</button>
              </div>
            </div>
          </PanelSection>
        </InstrumentPanel>
      </div>
    </div>
  )
}
