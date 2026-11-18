import { Bone, Group, MeshStandardMaterial, Quaternion, Skeleton, SkinnedMesh, Vector3, type BufferGeometry, type Object3D } from 'three'
import { Mesher, type V } from './geo.ts'

/** The pieces every creature is made of: a root, a bone list, and two skinned meshes (smooth tissue, faceted mineral). */
export class Rig {
  readonly root = new Group()
  readonly bones: Bone[] = []
  private readonly byName = new Map<string, number>()

  bone(name: string, parent: Object3D | null, pos: V): Bone {
    const b = new Bone()
    b.name = name
    b.position.set(pos[0], pos[1], pos[2])
    ;(parent ?? this.root).add(b)
    this.byName.set(name, this.bones.length)
    this.bones.push(b)
    return b
  }

  index(b: Bone | string): number {
    return this.byName.get(typeof b === 'string' ? b : b.name)!
  }

  /** Call once the bones stand in their bind pose, before any geometry is authored. */
  settle() {
    this.root.updateMatrixWorld(true)
  }

  mesher(flat: boolean) {
    return new Mesher(flat, this.bones)
  }

  /** Bind the finished geometry: one draw call for the tissue, one for the mineral. */
  skin(soft: BufferGeometry, hard: BufferGeometry, materials: { soft: MeshStandardMaterial; hard: MeshStandardMaterial }) {
    const skeleton = new Skeleton(this.bones)
    const meshes = [new SkinnedMesh(soft, materials.soft), new SkinnedMesh(hard, materials.hard)]
    for (const m of meshes) {
      m.frustumCulled = false
      m.castShadow = true
      m.receiveShadow = true
      this.root.add(m)
      m.bind(skeleton)
    }
    return { skeleton, meshes }
  }
}

/** Move `value` toward `target`, at a rate that does not depend on the frame time. */
export const approach = (value: number, target: number, rate: number, dt: number) => value + (target - value) * (1 - Math.exp(-rate * dt))

const AX: V = [1, 0, 0]
const AY: V = [0, 1, 0]
const AZ: V = [0, 0, 1]
export const X_AXIS = AX
export const Y_AXIS = AY
export const Z_AXIS = AZ

const q1 = new Quaternion()
const ax = new Vector3()
/** Set a bone's rotation as turns about fixed axes of its parent, applied left to right. */
export function turn(bone: Bone, ...parts: [V, number][]) {
  bone.quaternion.identity()
  for (const [axis, angle] of parts) {
    ax.set(axis[0], axis[1], axis[2])
    bone.quaternion.multiply(q1.setFromAxisAngle(ax, angle))
  }
}

/**
 * A jointed limb that hangs along -Y, solved in a vertical plane: two long segments reach an ankle (or wrist), a short one runs
 * from there to the foot, and the toes lie on the ground. A digitigrade leg: the animal stands on its toes, and what looks like a
 * backward knee is the ankle. `bend` is the way the middle joint folds: +1 forward (a hind leg's knee), -1 backward (an elbow).
 * An abduction turn about the body's long axis swings the whole limb out when the foot is placed to the side.
 */
const HIP_Q = new Quaternion()
const HIP_X = new Vector3()

export class Leg {
  readonly hip: Bone
  readonly abd: Bone
  readonly segs: Bone[] = []
  readonly lengths: number[]
  /** How far the last solve missed its target, in metres (the leg was stretched as far as it goes). */
  miss = 0
  private readonly bend: 1 | -1
  constructor(rig: Rig, parent: Object3D, name: string, pos: V, lengths: number[], bend: 1 | -1) {
    this.bend = bend
    this.lengths = lengths
    this.hip = rig.bone(`${name}.hip`, parent, pos)
    this.abd = rig.bone(`${name}.abd`, this.hip, [0, 0, 0])
    let up: Object3D = this.abd
    lengths.forEach((_, i) => {
      const b = rig.bone(`${name}.${i}`, up, i === 0 ? [0, 0, 0] : [0, -lengths[i - 1]!, 0])
      this.segs.push(b)
      up = b
    })
  }

  /** Reach for `foot` (world), with the foot bone leaning `lean` radians (the ankle behind the toes) and the toes `toe` below horizontal. */
  solve(foot: Vector3, lean: number, toe: number) {
    // `lean` and `toe` are angles to the GROUND, not to the hip: when the body pitches (a crouch drops the chest, a strider's trunk tilts), the
    // limb is solved in the hip's own frame, so the hip's pitch is taken off here. Before, a chest pitched down in a crouch tipped the fore
    // feet's toes into the ground by the same angle.
    this.hip.getWorldQuaternion(HIP_Q)
    HIP_X.set(1, 0, 0).applyQuaternion(HIP_Q)
    const toeRel = Math.PI / 2 - toe - lean
    lean -= Math.asin(Math.max(-1, Math.min(1, HIP_X.y / Math.max(1e-6, HIP_X.length()))))
    const t = this.hip.worldToLocal(foot.clone())
    const r = Math.hypot(t.y, t.z)
    this.abd.rotation.set(Math.atan2(-t.z, -t.y), 0, 0)
    const [a, b, c] = this.lengths as [number, number, number, number?]
    // The ankle stands behind and above the foot.
    const ax2 = t.x - c * Math.sin(lean)
    const ay2 = -r + c * Math.cos(lean)
    const dist = Math.hypot(ax2, ay2)
    const d = Math.min(dist, a + b - 1e-4)
    this.miss = Math.max(0, dist - (a + b))
    const alpha = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))))
    const toAnkle = Math.atan2(ax2, -ay2)
    const psi1 = toAnkle + this.bend * alpha
    const kx = a * Math.sin(psi1)
    const ky = -a * Math.cos(psi1)
    const ex = d === dist ? ax2 : (ax2 / dist) * d
    const ey = d === dist ? ay2 : (ay2 / dist) * d
    const psi2 = Math.atan2(ex - kx, -(ey - ky))
    this.segs[0]!.rotation.set(0, 0, psi1)
    this.segs[1]!.rotation.set(0, 0, psi2 - psi1)
    this.segs[2]!.rotation.set(0, 0, lean - psi2)
    if (this.segs[3]) this.segs[3].rotation.set(0, 0, toeRel)
  }
}
