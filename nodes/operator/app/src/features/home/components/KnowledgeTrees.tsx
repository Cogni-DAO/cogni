// @ts-nocheck — Three.js R3F JSX intrinsic elements not typed in strict mode
"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/* ─── Config ──────────────────────────────────────── */

const TREE_COUNT = 5;
const BACKGROUND_PARTICLES = 100;
const BOUNDS_X = 11;

// Neon palette — each tree is a distinct organism
const TREE_COLORS: { r: number; g: number; b: number }[] = [
  { r: 1.0, g: 0.78, b: 0.15 }, // amber
  { r: 0.15, g: 0.92, b: 0.65 }, // emerald
  { r: 0.3, g: 0.5, b: 1.0 }, // cobalt
  { r: 0.45, g: 0.95, b: 0.35 }, // chartreuse
  { r: 0.7, g: 0.25, b: 0.95 }, // violet
];

/* ─── Helpers ─────────────────────────────────────── */

interface TreeBranch {
  points: [number, number, number][];
  color: { r: number; g: number; b: number };
  depth: number;
}

/** Seeded PRNG for deterministic trees across renders */
function seedRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Generate a recursive tree structure from a root position */
function generateTree(
  rootX: number,
  rootY: number,
  color: { r: number; g: number; b: number },
  maxDepth: number,
  seed: number
): TreeBranch[] {
  const branches: TreeBranch[] = [];
  const rng = seedRandom(seed);

  function branch(
    x: number,
    y: number,
    z: number,
    angle: number,
    length: number,
    depth: number
  ): void {
    if (depth > maxDepth || length < 0.12) return;

    const segments = 5 + Math.floor(rng() * 3);
    const pts: [number, number, number][] = [[x, y, z]];

    let cx = x;
    let cy = y;
    let cz = z;

    for (let s = 0; s < segments; s++) {
      const segLen = length / segments;
      // Organic wobble increases with depth
      const wobble = (rng() - 0.5) * (0.25 + depth * 0.1);
      cx += Math.sin(angle + wobble) * segLen;
      cy += Math.cos(angle * 0.3) * segLen + segLen * 0.65;
      cz += (rng() - 0.5) * 0.12;
      pts.push([cx, cy, cz]);
    }

    branches.push({ points: pts, color, depth });

    // Branching factor decreases with depth
    const forkCount =
      depth < 2 ? 2 + Math.floor(rng() * 2) : 1 + Math.floor(rng() * 2);
    for (let f = 0; f < forkCount; f++) {
      const spread = depth < 1 ? 1.2 : 1.8;
      const newAngle = angle + (rng() - 0.5) * spread;
      const newLength = length * (0.5 + rng() * 0.28);
      branch(cx, cy, cz, newAngle, newLength, depth + 1);
    }
  }

  // Main trunk
  branch(rootX, rootY, 0, 0, 1.4 + rng() * 1.2, 0);
  return branches;
}

/** Deterministic tree root positions */
function getTreeRoots(seed: number): { x: number; y: number }[] {
  const rng = seedRandom(seed);
  const spacing = (BOUNDS_X * 2) / (TREE_COUNT + 1);
  return Array.from({ length: TREE_COUNT }, (_, i) => ({
    x: -BOUNDS_X + spacing * (i + 1) + (rng() - 0.5) * 1.8,
    y: -4.0 + rng() * 0.6,
  }));
}

const TREE_ROOTS = getTreeRoots(31337);

/** Build all trees deterministically */
function getAllTrees(): TreeBranch[][] {
  return TREE_ROOTS.map((root, i) => {
    const color = TREE_COLORS[i % TREE_COLORS.length];
    const maxDepth = 3 + (i % 2); // Vary height: 3 or 4
    return generateTree(root.x, root.y, color, maxDepth, (i + 1) * 7919);
  });
}

const ALL_TREES = getAllTrees();
const ALL_BRANCHES = ALL_TREES.flat();

/* ─── Tree Branches (glowing lines) ───────────────── */

function TreeLines(): ReactElement {
  // biome-ignore lint/style/noNonNullAssertion: three.js ref pattern
  const lineRef = useRef<THREE.LineSegments>(null!);

  const { positionArray, colorArray } = useMemo(() => {
    let totalSegs = 0;
    for (const b of ALL_BRANCHES) {
      totalSegs += Math.max(0, b.points.length - 1);
    }

    const pos = new Float32Array(totalSegs * 6);
    const col = new Float32Array(totalSegs * 6);
    let idx = 0;

    for (const b of ALL_BRANCHES) {
      const brightness = Math.max(0.25, 1 - b.depth * 0.22);
      for (let p = 0; p < b.points.length - 1; p++) {
        const [x1, y1, z1] = b.points[p];
        const [x2, y2, z2] = b.points[p + 1];
        pos[idx] = x1;
        pos[idx + 1] = y1;
        pos[idx + 2] = z1;
        pos[idx + 3] = x2;
        pos[idx + 4] = y2;
        pos[idx + 5] = z2;
        col[idx] = b.color.r * brightness;
        col[idx + 1] = b.color.g * brightness;
        col[idx + 2] = b.color.b * brightness;
        col[idx + 3] = b.color.r * brightness;
        col[idx + 4] = b.color.g * brightness;
        col[idx + 5] = b.color.b * brightness;
        idx += 6;
      }
    }

    return { positionArray: pos, colorArray: col };
  }, []);

  // Animate: wave pulse traveling upward through branches
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const geom = lineRef.current.geometry;
    const colAttr = geom.getAttribute("color");
    if (!colAttr) return;
    const arr = colAttr.array as Float32Array;

    let segIdx = 0;
    for (const b of ALL_BRANCHES) {
      const brightness = Math.max(0.25, 1 - b.depth * 0.22);
      for (let p = 0; p < b.points.length - 1; p++) {
        // Pulse wave that travels upward along the Y axis
        const y = b.points[p][1];
        const wave = 0.5 + 0.5 * Math.sin(t * 0.6 - y * 0.8 + segIdx * 0.05);
        const a = brightness * (0.4 + wave * 0.6);
        const i = segIdx * 6;
        arr[i] = b.color.r * a;
        arr[i + 1] = b.color.g * a;
        arr[i + 2] = b.color.b * a;
        arr[i + 3] = b.color.r * a;
        arr[i + 4] = b.color.g * a;
        arr[i + 5] = b.color.b * a;
        segIdx++;
      }
    }
    colAttr.needsUpdate = true;
  });

  return (
    <lineSegments ref={lineRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positionArray, 3]}
        />
        <bufferAttribute attach="attributes-color" args={[colorArray, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={1}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}

/* ─── Node glow points at branch junctions + tips ── */

function TreeNodes(): ReactElement {
  // biome-ignore lint/style/noNonNullAssertion: three.js ref pattern
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  // biome-ignore lint/style/noNonNullAssertion: three.js ref pattern
  const colorRef = useRef<THREE.InstancedBufferAttribute>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const { nodePositions, nodeColors, count } = useMemo(() => {
    const positions: [number, number, number][] = [];
    const colors: { r: number; g: number; b: number }[] = [];

    for (const b of ALL_BRANCHES) {
      // Tip of each branch
      const last = b.points[b.points.length - 1];
      positions.push(last);
      colors.push(b.color);
      // Junction point for deeper branches
      if (b.depth > 0 && b.points.length > 2) {
        positions.push(b.points[0]);
        colors.push(b.color);
      }
    }

    return {
      nodePositions: positions,
      nodeColors: colors,
      count: positions.length,
    };
  }, []);

  const colorArray = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = nodeColors[i].r;
      arr[i * 3 + 1] = nodeColors[i].g;
      arr[i * 3 + 2] = nodeColors[i].b;
    }
    return arr;
  }, [count, nodeColors]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    for (let i = 0; i < count; i++) {
      const [x, y, z] = nodePositions[i];
      dummy.position.set(x, y, z);
      // Breathing glow — staggered per node
      const s = 0.6 + 0.4 * Math.sin(t * 1.0 + i * 0.6);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[0.045, 6, 6]}>
        <instancedBufferAttribute
          ref={colorRef}
          attach="attributes-color"
          args={[colorArray, 3]}
        />
      </sphereGeometry>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.9}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}

/* ─── Rising energy particles along branches ──────── */

function EnergyParticles(): ReactElement {
  // biome-ignore lint/style/noNonNullAssertion: three.js ref pattern
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  // biome-ignore lint/style/noNonNullAssertion: three.js ref pattern
  const colorRef = useRef<THREE.InstancedBufferAttribute>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const { particles, colorArray } = useMemo(() => {
    const pts: {
      path: [number, number, number][];
      color: { r: number; g: number; b: number };
      speed: number;
      offset: number;
    }[] = [];

    // Select branches for particles — trunk + mid-depth branches
    for (const b of ALL_BRANCHES) {
      if (b.depth > 2) continue;
      if (b.points.length < 3) continue;
      pts.push({
        path: b.points,
        color: b.color,
        speed: 0.12 + b.depth * 0.05 + (pts.length % 5) * 0.04,
        offset: (pts.length * 0.37) % 1,
      });
      if (pts.length >= 50) break;
    }

    const colArr = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      colArr[i * 3] = pts[i].color.r;
      colArr[i * 3 + 1] = pts[i].color.g;
      colArr[i * 3 + 2] = pts[i].color.b;
    }

    return { particles: pts, colorArray: colArr };
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const progress = (t * p.speed + p.offset) % 1;
      const pathLen = p.path.length - 1;
      const segFloat = progress * pathLen;
      const seg = Math.min(Math.floor(segFloat), pathLen - 1);
      const frac = segFloat - seg;

      const [x1, y1, z1] = p.path[seg];
      const [x2, y2, z2] = p.path[Math.min(seg + 1, pathLen)];

      dummy.position.set(
        x1 + (x2 - x1) * frac,
        y1 + (y2 - y1) * frac,
        z1 + (z2 - z1) * frac
      );

      // Fade in at start, peak in middle, fade at end
      const fade = Math.sin(progress * Math.PI);
      dummy.scale.setScalar(0.4 + fade * 1.8);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, particles.length]}
    >
      <sphereGeometry args={[0.025, 6, 6]}>
        <instancedBufferAttribute
          ref={colorRef}
          attach="attributes-color"
          args={[colorArray, 3]}
        />
      </sphereGeometry>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.85}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}

/* ─── Cross-tree connections (merging branches) ───── */

function CrossConnections(): ReactElement | null {
  // biome-ignore lint/style/noNonNullAssertion: three.js ref pattern
  const lineRef = useRef<THREE.LineSegments>(null!);

  const { posArray, colArray, count } = useMemo(() => {
    const allTips: {
      pos: [number, number, number];
      color: { r: number; g: number; b: number };
      treeIdx: number;
    }[] = [];

    ALL_TREES.forEach((treeBranches, treeIdx) => {
      for (const b of treeBranches) {
        if (b.depth >= 2) {
          allTips.push({
            pos: b.points[b.points.length - 1],
            color: b.color,
            treeIdx,
          });
        }
      }
    });

    const CONNECTION_RANGE = 3.0;
    const segments: {
      from: [number, number, number];
      to: [number, number, number];
      c1: { r: number; g: number; b: number };
      c2: { r: number; g: number; b: number };
    }[] = [];

    for (let i = 0; i < allTips.length; i++) {
      for (let j = i + 1; j < allTips.length; j++) {
        if (allTips[i].treeIdx === allTips[j].treeIdx) continue;
        const dx = allTips[i].pos[0] - allTips[j].pos[0];
        const dy = allTips[i].pos[1] - allTips[j].pos[1];
        const dz = allTips[i].pos[2] - allTips[j].pos[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < CONNECTION_RANGE && segments.length < 12) {
          segments.push({
            from: allTips[i].pos,
            to: allTips[j].pos,
            c1: allTips[i].color,
            c2: allTips[j].color,
          });
        }
      }
    }

    const pos = new Float32Array(segments.length * 6);
    const col = new Float32Array(segments.length * 6);
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const idx = i * 6;
      pos[idx] = s.from[0];
      pos[idx + 1] = s.from[1];
      pos[idx + 2] = s.from[2];
      pos[idx + 3] = s.to[0];
      pos[idx + 4] = s.to[1];
      pos[idx + 5] = s.to[2];
      col[idx] = s.c1.r * 0.25;
      col[idx + 1] = s.c1.g * 0.25;
      col[idx + 2] = s.c1.b * 0.25;
      col[idx + 3] = s.c2.r * 0.25;
      col[idx + 4] = s.c2.g * 0.25;
      col[idx + 5] = s.c2.b * 0.25;
    }

    return { posArray: pos, colArray: col, count: segments.length };
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const geom = lineRef.current.geometry;
    const colAttr = geom.getAttribute("color");
    if (!colAttr) return;
    const arr = colAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const pulse = 0.2 + 0.8 * Math.abs(Math.sin(t * 0.4 + i * 1.5));
      const idx = i * 6;
      for (let c = 0; c < 6; c++) {
        arr[idx + c] = colArray[idx + c] * pulse;
      }
    }
    colAttr.needsUpdate = true;
  });

  if (count === 0) return null;

  return (
    <lineSegments ref={lineRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[posArray, 3]} />
        <bufferAttribute attach="attributes-color" args={[colArray, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={1}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}

/* ─── Ambient bokeh (floating dust motes) ──────────── */

function AmbientBokeh(): ReactElement {
  // biome-ignore lint/style/noNonNullAssertion: three.js ref pattern
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  // biome-ignore lint/style/noNonNullAssertion: three.js ref pattern
  const colorRef = useRef<THREE.InstancedBufferAttribute>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const { positions, velocities, colors, sizes } = useMemo(() => {
    const rng = seedRandom(42069);
    const pos = Array.from({ length: BACKGROUND_PARTICLES }, () => [
      (rng() - 0.5) * 22,
      (rng() - 0.5) * 16,
      (rng() - 0.5) * 8 - 2,
    ]);
    const vel = Array.from({ length: BACKGROUND_PARTICLES }, () => [
      (rng() - 0.5) * 0.002,
      rng() * 0.003 + 0.0008,
      (rng() - 0.5) * 0.0005,
    ]);
    const col = new Float32Array(BACKGROUND_PARTICLES * 3);
    const sz = new Float32Array(BACKGROUND_PARTICLES);
    for (let i = 0; i < BACKGROUND_PARTICLES; i++) {
      const c = TREE_COLORS[Math.floor(rng() * TREE_COLORS.length)];
      const dim = 0.2 + rng() * 0.25;
      col[i * 3] = c.r * dim;
      col[i * 3 + 1] = c.g * dim;
      col[i * 3 + 2] = c.b * dim;
      sz[i] = 0.2 + rng() * 0.5;
    }
    return { positions: pos, velocities: vel, colors: col, sizes: sz };
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    for (let i = 0; i < BACKGROUND_PARTICLES; i++) {
      positions[i][0] += velocities[i][0];
      positions[i][1] += velocities[i][1];
      positions[i][2] += velocities[i][2];

      // Wrap vertically
      if (positions[i][1] > 8) positions[i][1] = -8;
      if (Math.abs(positions[i][0]) > 12) positions[i][0] *= -0.95;

      dummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
      // Subtle twinkle
      const twinkle = 0.6 + 0.4 * Math.sin(t * 1.5 + i * 2.3);
      dummy.scale.setScalar(sizes[i] * twinkle);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, BACKGROUND_PARTICLES]}
    >
      <sphereGeometry args={[0.035, 4, 4]}>
        <instancedBufferAttribute
          ref={colorRef}
          attach="attributes-color"
          args={[colors, 3]}
        />
      </sphereGeometry>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.6}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}

/* ─── Scene ────────────────────────────────────────── */

function Scene(): ReactElement {
  return (
    <>
      <TreeLines />
      <TreeNodes />
      <EnergyParticles />
      <CrossConnections />
      <AmbientBokeh />
    </>
  );
}

/* ─── Exported wrapper ─────────────────────────────── */

export function KnowledgeTreesBackground(): ReactElement {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="absolute inset-0" />;

  return (
    <div className="absolute inset-0 opacity-75">
      <Canvas
        camera={{ position: [0, 0.5, 10], fov: 52 }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, alpha: true }}
        className="bg-transparent"
      >
        <Scene />
      </Canvas>
    </div>
  );
}
