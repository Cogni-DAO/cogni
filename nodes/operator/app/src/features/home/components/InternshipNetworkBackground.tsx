// @ts-nocheck
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/components/InternshipNetworkBackground`
 * Purpose: Three.js network backdrop for the internship recruiting homepage.
 * Scope: Client-only visual layer. Does not fetch data or handle input.
 * Invariants: Mounts only in the browser; decorative canvas stays behind content.
 * Side-effects: animation frame rendering
 * Links: story.5001, nodes/poly/app/src/components/NeuralNetwork.tsx
 * @public
 */

"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useTheme } from "next-themes";
import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const NODE_COUNT = 78;
const CONNECTION_DISTANCE = 2.9;
const PULSE_COUNT = 24;
const BOUNDS = { x: 8, y: 5, z: 4 };

const DARK_COLORS = {
  cyan: { r: 0.12, g: 0.72, b: 0.88 },
  green: { r: 0.25, g: 0.78, b: 0.5 },
  orange: { r: 0.95, g: 0.48, b: 0.18 },
  nodeOpacity: 0.75,
  connectionAlpha: 0.4,
  pulseOpacity: 0.9,
};

const LIGHT_COLORS = {
  cyan: { r: 0.32, g: 0.55, b: 0.58 },
  green: { r: 0.18, g: 0.48, b: 0.38 },
  orange: { r: 0.72, g: 0.56, b: 0.34 },
  nodeOpacity: 0.18,
  connectionAlpha: 0.012,
  pulseOpacity: 0.16,
};

function crossesContentZone(start: number[], end: number[]): boolean {
  const minX = Math.min(start[0], end[0]);
  const maxX = Math.max(start[0], end[0]);
  const minY = Math.min(start[1], end[1]);
  const maxY = Math.max(start[1], end[1]);

  return minX < 3.35 && maxX > -3.35 && minY < 1.9 && maxY > -1.9;
}

function lerpColor(
  a: typeof CYAN,
  b: typeof CYAN,
  t: number
): { r: number; g: number; b: number } {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function makePositions(): number[][] {
  return Array.from({ length: NODE_COUNT }, () => [
    (Math.random() - 0.5) * BOUNDS.x * 2,
    (Math.random() - 0.5) * BOUNDS.y * 2,
    (Math.random() - 0.5) * BOUNDS.z * 2,
  ]);
}

function makeVelocities(): number[][] {
  return Array.from({ length: NODE_COUNT }, () => [
    (Math.random() - 0.5) * 0.0014,
    (Math.random() - 0.5) * 0.0014,
    (Math.random() - 0.5) * 0.0008,
  ]);
}

function drift(positions: number[][], velocities: number[][]): void {
  for (let i = 0; i < NODE_COUNT; i++) {
    positions[i][0] += velocities[i][0];
    positions[i][1] += velocities[i][1];
    positions[i][2] += velocities[i][2];

    for (let axis = 0; axis < 3; axis++) {
      const bound = [BOUNDS.x, BOUNDS.y, BOUNDS.z][axis];
      if (Math.abs(positions[i][axis]) > bound) {
        velocities[i][axis] *= -1;
      }
    }
  }
}

function Nodes({ colors }: { colors: typeof DARK_COLORS }): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const colorRef = useRef<THREE.InstancedBufferAttribute>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const positions = useMemo(makePositions, []);
  const velocities = useMemo(makeVelocities, []);
  const colorArray = useMemo(() => new Float32Array(NODE_COUNT * 3), []);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;

    const t = clock.getElapsedTime();
    drift(positions, velocities);

    for (let i = 0; i < NODE_COUNT; i++) {
      dummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      const colorT = 0.5 + 0.5 * Math.sin(t * 0.18 + i * 1.1);
      const base = lerpColor(colors.cyan, colors.green, colorT);
      const warm = lerpColor(base, colors.orange, colorT * 0.25);
      colorArray[i * 3] = warm.r;
      colorArray[i * 3 + 1] = warm.g;
      colorArray[i * 3 + 2] = warm.b;
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (colorRef.current) colorRef.current.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, NODE_COUNT]}>
      <sphereGeometry args={[0.035, 8, 8]}>
        <instancedBufferAttribute
          ref={colorRef}
          attach="attributes-color"
          args={[colorArray, 3]}
        />
      </sphereGeometry>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={colors.nodeOpacity}
      />
    </instancedMesh>
  );
}

function Connections({
  colors,
  excludeContent,
}: {
  colors: typeof DARK_COLORS;
  excludeContent: boolean;
}): ReactElement {
  const lineRef = useRef<THREE.LineSegments>(null);
  const positions = useMemo(makePositions, []);
  const velocities = useMemo(makeVelocities, []);
  const maxSegments = NODE_COUNT * 6;
  const positionBuffer = useMemo(
    () => new Float32Array(maxSegments * 6),
    [maxSegments]
  );
  const colorBuffer = useMemo(
    () => new Float32Array(maxSegments * 6),
    [maxSegments]
  );

  useFrame(({ clock }) => {
    if (!lineRef.current) return;

    const t = clock.getElapsedTime();
    drift(positions, velocities);

    let segCount = 0;
    for (let i = 0; i < NODE_COUNT && segCount < maxSegments; i++) {
      for (let j = i + 1; j < NODE_COUNT && segCount < maxSegments; j++) {
        const dx = positions[i][0] - positions[j][0];
        const dy = positions[i][1] - positions[j][1];
        const dz = positions[i][2] - positions[j][2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (
          dist < CONNECTION_DISTANCE &&
          !(excludeContent && crossesContentZone(positions[i], positions[j]))
        ) {
          const alpha = 1 - dist / CONNECTION_DISTANCE;
          const pulse =
            0.3 + 0.7 * Math.abs(Math.sin(t * 0.35 + i * 0.24 + j * 0.1));
          const finalAlpha = alpha * pulse * colors.connectionAlpha;
          const colorT = 0.5 + 0.5 * Math.sin(t * 0.2 + i * 0.7 + j * 0.4);
          const c = lerpColor(colors.cyan, colors.green, colorT);

          const idx = segCount * 6;
          positionBuffer[idx] = positions[i][0];
          positionBuffer[idx + 1] = positions[i][1];
          positionBuffer[idx + 2] = positions[i][2];
          positionBuffer[idx + 3] = positions[j][0];
          positionBuffer[idx + 4] = positions[j][1];
          positionBuffer[idx + 5] = positions[j][2];

          colorBuffer[idx] = c.r * finalAlpha;
          colorBuffer[idx + 1] = c.g * finalAlpha;
          colorBuffer[idx + 2] = c.b * finalAlpha;
          colorBuffer[idx + 3] = c.r * finalAlpha;
          colorBuffer[idx + 4] = c.g * finalAlpha;
          colorBuffer[idx + 5] = c.b * finalAlpha;

          segCount++;
        }
      }
    }

    const geom = lineRef.current.geometry;
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(positionBuffer.slice(0, segCount * 6), 3)
    );
    geom.setAttribute(
      "color",
      new THREE.BufferAttribute(colorBuffer.slice(0, segCount * 6), 3)
    );
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;
  });

  return (
    <lineSegments ref={lineRef}>
      <bufferGeometry />
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={1}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}

function DataPulses({ colors }: { colors: typeof DARK_COLORS }): ReactElement {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const colorRef = useRef<THREE.InstancedBufferAttribute>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const positions = useMemo(makePositions, []);
  const velocities = useMemo(makeVelocities, []);
  const colorArray = useMemo(() => new Float32Array(PULSE_COUNT * 3), []);
  const pulses = useMemo(
    () =>
      Array.from({ length: PULSE_COUNT }, () => ({
        startNode: Math.floor(Math.random() * NODE_COUNT),
        endNode: Math.floor(Math.random() * NODE_COUNT),
        progress: Math.random(),
        speed: 0.0015 + Math.random() * 0.003,
        warm: Math.random() > 0.65,
      })),
    []
  );

  useFrame(() => {
    if (!meshRef.current) return;

    drift(positions, velocities);

    for (let i = 0; i < PULSE_COUNT; i++) {
      const p = pulses[i];
      p.progress += p.speed;

      if (p.progress > 1) {
        p.progress = 0;
        p.startNode = Math.floor(Math.random() * NODE_COUNT);
        p.endNode = Math.floor(Math.random() * NODE_COUNT);
        p.speed = 0.0015 + Math.random() * 0.003;
        p.warm = Math.random() > 0.65;
      }

      const s = positions[p.startNode];
      const e = positions[p.endNode];
      const t = p.progress;

      dummy.position.set(
        s[0] + (e[0] - s[0]) * t,
        s[1] + (e[1] - s[1]) * t,
        s[2] + (e[2] - s[2]) * t
      );
      dummy.scale.setScalar(0.7 + Math.sin(t * Math.PI) * 1.4);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      const c = p.warm ? colors.orange : colors.cyan;
      colorArray[i * 3] = c.r;
      colorArray[i * 3 + 1] = c.g;
      colorArray[i * 3 + 2] = c.b;
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (colorRef.current) colorRef.current.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PULSE_COUNT]}>
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
        opacity={colors.pulseOpacity}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}

function Scene({
  colors,
  isLight,
}: {
  colors: typeof DARK_COLORS;
  isLight: boolean;
}): ReactElement {
  return (
    <>
      <Nodes colors={colors} />
      <Connections colors={colors} excludeContent={isLight} />
      <DataPulses colors={colors} />
    </>
  );
}

export function InternshipNetworkBackground(): ReactElement {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="absolute inset-0" />;

  const isLight = resolvedTheme === "light";
  const colors = isLight ? LIGHT_COLORS : DARK_COLORS;

  return (
    <div
      className={
        isLight ? "absolute inset-0 opacity-15" : "absolute inset-0 opacity-70"
      }
    >
      <Canvas
        camera={{ position: [0, 0, 7], fov: 60 }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, alpha: true, preserveDrawingBuffer: true }}
      >
        <Scene colors={colors} isLight={isLight} />
      </Canvas>
    </div>
  );
}
