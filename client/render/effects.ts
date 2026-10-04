import {
  AdditiveBlending,
  type Camera,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';

/**
 * Juice (BUILD_PROMPT.md §6): sparks, gore, dust and smoke as particles, plus expanding rings
 * on the ground. Glowing particles are camera-facing sprites drawn additively; solid ones are
 * little low-poly lumps. Each kind is one instanced draw call however many are flying.
 */

export type ParticleKind = 'spark' | 'ember' | 'blood' | 'dust' | 'smoke';

interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  spin: number;
  color: Color;
}

interface Ring {
  x: number;
  y: number;
  z: number;
  age: number;
  life: number;
  radius: number;
  color: Color;
}

/** How each kind of particle moves and looks. */
type Look = 'glow' | 'lump' | 'puff';

const KINDS: Readonly<
  Record<ParticleKind, { look: Look; gravity: number; drag: number; grow: number }>
> = {
  spark: { look: 'glow', gravity: -4, drag: 1.5, grow: -0.6 },
  ember: { look: 'glow', gravity: 1.5, drag: 0.6, grow: -0.8 },
  blood: { look: 'lump', gravity: -14, drag: 0.5, grow: -0.7 },
  dust: { look: 'puff', gravity: 0.6, drag: 3, grow: 1.4 },
  smoke: { look: 'puff', gravity: 1.2, drag: 0.3, grow: 1.6 },
};

const MAX: Readonly<Record<Look, number>> = { glow: 700, lump: 600, puff: 500 };
const MAX_RINGS = 12;

const matrix = new Matrix4();
const tint = new Color();
const position = new Vector3();
const scale = new Vector3();
const rotation = new Quaternion();
const spin = new Quaternion();
const axis = new Vector3(0.3, 1, 0.2).normalize();
const facing = new Vector3();
const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

/** A soft round glow, drawn once into a small canvas. */
function glowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(canvas);
}

export class Effects {
  readonly group = new Group();
  private readonly glows: InstancedMesh;
  private readonly lumps: InstancedMesh;
  private readonly puffs: InstancedMesh;
  private readonly rings: InstancedMesh;
  private readonly particles: Particle[] = [];
  private readonly ringList: Ring[] = [];
  private readonly spare: Particle[] = [];

  constructor() {
    const soft = glowTexture();
    this.glows = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: soft,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
      MAX.glow,
    );
    this.lumps = new InstancedMesh(
      new IcosahedronGeometry(0.5, 0),
      new MeshLambertMaterial({ flatShading: true }),
      MAX.lump,
    );
    // Smoke and dust: soft, see-through billows.
    this.puffs = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshLambertMaterial({ map: soft, transparent: true, opacity: 0.6, depthWrite: false }),
      MAX.puff,
    );
    this.rings = new InstancedMesh(
      new RingGeometry(0.82, 1, 40),
      new MeshBasicMaterial({
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
      MAX_RINGS,
    );
    for (const mesh of [this.glows, this.lumps, this.puffs, this.rings]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      // Allocate per-instance colours up front.
      mesh.setColorAt(0, new Color());
    }
    this.glows.name = 'effects-glow';
    this.lumps.name = 'effects-lumps';
    this.puffs.name = 'effects-puffs';
    this.rings.name = 'effects-rings';
    this.group.add(this.glows, this.lumps, this.puffs, this.rings);
  }

  /** Throw out `count` particles from a point, flying `speed` fast, mostly upwards by `lift`. */
  burst(
    kind: ParticleKind,
    at: { readonly x: number; readonly y: number; readonly z: number },
    count: number,
    options: {
      readonly speed: number;
      readonly size: number;
      readonly life: number;
      readonly color: number;
      readonly lift?: number;
      readonly spread?: number;
    },
  ): void {
    const look = KINDS[kind].look;
    let live = 0;
    for (const p of this.particles) if (KINDS[p.kind].look === look) live++;
    const room = MAX[look] - live;
    for (let i = 0; i < Math.min(count, room); i++) {
      const angle = Math.random() * Math.PI * 2;
      const up = (options.lift ?? 0.5) + (Math.random() - 0.5) * (options.spread ?? 0.6);
      const speed = options.speed * (0.4 + 0.6 * Math.random());
      const across = Math.sqrt(Math.max(0, 1 - up * up));
      const p = this.spare.pop() ?? ({ color: new Color() } as Particle);
      p.kind = kind;
      p.x = at.x;
      p.y = at.y;
      p.z = at.z;
      p.vx = Math.cos(angle) * across * speed;
      p.vy = up * speed;
      p.vz = Math.sin(angle) * across * speed;
      p.age = 0;
      p.life = options.life * (0.6 + 0.4 * Math.random());
      p.size = options.size * (0.6 + 0.4 * Math.random());
      p.spin = Math.random() * Math.PI * 2;
      p.color.set(options.color).multiplyScalar(0.85 + 0.3 * Math.random());
      this.particles.push(p);
    }
  }

  /** A ring racing outward across the ground. */
  ring(
    at: { readonly x: number; readonly y: number; readonly z: number },
    radius: number,
    life: number,
    color: number,
  ): void {
    if (this.ringList.length >= MAX_RINGS) this.ringList.shift();
    this.ringList.push({
      x: at.x,
      y: at.y,
      z: at.z,
      age: 0,
      life,
      radius,
      color: new Color(color),
    });
  }

  /** The evolution burst: a fountain of golden sparks and a ring of light. */
  evolve(
    at: { readonly x: number; readonly y: number; readonly z: number },
    bodyScale: number,
  ): void {
    const centre = { x: at.x, y: at.y + 0.5 * bodyScale, z: at.z };
    this.burst('spark', centre, 70, {
      speed: 7 * Math.sqrt(bodyScale),
      size: 0.35 * bodyScale,
      life: 1.3,
      color: 0xffd25a,
      lift: 0.55,
      spread: 0.9,
    });
    this.burst('spark', centre, 30, {
      speed: 10 * Math.sqrt(bodyScale),
      size: 0.25 * bodyScale,
      life: 1.6,
      color: 0xfff2c0,
      lift: 0.95,
      spread: 0.2,
    });
    this.ring({ x: at.x, y: at.y + 0.08, z: at.z }, 4 * bodyScale, 0.9, 0xffc845);
    this.ring({ x: at.x, y: at.y + 0.1, z: at.z }, 2.5 * bodyScale, 0.6, 0xfff4c8);
  }

  update(dt: number, camera: Camera): void {
    let glows = 0;
    let lumps = 0;
    let puffs = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.particles.splice(i, 1);
        this.spare.push(p);
        continue;
      }
      const kind = KINDS[p.kind];
      const drag = Math.exp(-kind.drag * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag + kind.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.age / p.life;
      const size = Math.max(p.size * (1 + kind.grow * t), 0.001);
      position.set(p.x, p.y, p.z);
      if (kind.look === 'glow') {
        if (glows >= MAX.glow) continue;
        matrix.compose(position, camera.quaternion, scale.setScalar(size));
        this.glows.setMatrixAt(glows, matrix);
        this.glows.setColorAt(glows, tint.copy(p.color).multiplyScalar(1 - t * t));
        glows++;
      } else if (kind.look === 'puff') {
        if (puffs >= MAX.puff) continue;
        // Billows fade in, then thin away: shrink the last part instead of fading.
        const fade = Math.min(t * 6, 1) * (1 - t * t);
        spin.setFromAxisAngle(facing.set(0, 0, 1), p.spin);
        rotation.copy(camera.quaternion).multiply(spin);
        matrix.compose(position, rotation, scale.setScalar(size * (0.4 + 0.6 * fade)));
        this.puffs.setMatrixAt(puffs, matrix);
        this.puffs.setColorAt(puffs, p.color);
        puffs++;
      } else {
        if (lumps >= MAX.lump) continue;
        spin.setFromAxisAngle(axis, p.spin + p.age * 3);
        matrix.compose(position, spin, scale.setScalar(size));
        this.lumps.setMatrixAt(lumps, matrix);
        this.lumps.setColorAt(lumps, p.color);
        lumps++;
      }
    }
    this.glows.count = glows;
    this.lumps.count = lumps;
    this.puffs.count = puffs;

    let rings = 0;
    for (let i = this.ringList.length - 1; i >= 0; i--) {
      const ring = this.ringList[i];
      ring.age += dt;
      if (ring.age >= ring.life) {
        this.ringList.splice(i, 1);
        continue;
      }
      const t = ring.age / ring.life;
      position.set(ring.x, ring.y, ring.z);
      rotation.copy(flat);
      matrix.compose(
        position,
        rotation,
        scale.setScalar(ring.radius * (0.15 + 0.85 * Math.sqrt(t))),
      );
      this.rings.setMatrixAt(rings, matrix);
      this.rings.setColorAt(rings, tint.copy(ring.color).multiplyScalar(1 - t));
      rings++;
    }
    this.rings.count = rings;
    for (const mesh of [this.glows, this.lumps, this.puffs, this.rings]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
