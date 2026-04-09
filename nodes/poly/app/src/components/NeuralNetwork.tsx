// @ts-nocheck — Three.js R3F JSX intrinsic elements not typed in strict mode
"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const NODE_COUNT = 90;
const CONNECTION_DISTANCE = 2.8;
const PULSE_COUNT = 30;
const BOUNDS = { x: 8, y: 5, z: 4 };

// Green/red palette (muted, prediction-market vibes)
const GREEN = { r: 0.3, g: 0.78, b: 0.55 }; // muted green — "yes"
const RED = { r: 0.75, g: 0.3, b: 0.35 }; // muted red — "no"

function lerpColor(
  a: typeof GREEN,
  b: typeof GREEN,
  t: number
): { r: number; g: number; b: number } {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/* ─── Connections (lines + nodes in one pass) ───── */

function Connections(): ReactElement {
  // biome-ignore lint/style/noNonNullAssertion: three.js ref pattern
  const lineRef = useRef<THREE.LineSegments>(null!);

  const positions = useMemo(() => {
    return Array.from({ length: NODE_COUNT }, () => [
      (Math.random() - 0.5) * BOUNDS.x * 2,
      (Math.random() - 0.5) * BOUNDS.y * 2,
      (Math.random() - 0.5) * BOUNDS.z * 2,
    ]);
  }, []);

  // Much slower velocities
  const velocities = useMemo(
    () =>
      Array.from({ length: NODE_COUNT }, () => [
        (Math.random() - 0.5) * 0.0012,
        (Math.random() - 0.5) * 0.0012,
        (Math.random() - 0.5) * 0.0008,
      ]),
    []
  );

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
    const t = clock.getElapsedTime();

    // Update positions (slow drift)
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

    // Build connections with green/red oscillation
    let segCount = 0;
    for (let i = 0; i < NODE_COUNT && segCount < maxSegments; i++) {
      for (let j = i + 1; j < NODE_COUNT && segCount < maxSegments; j++) {
        const dx = positions[i][0] - positions[j][0];
        const dy = positions[i][1] - positions[j][1];
        const dz = positions[i][2] - positions[j][2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < CONNECTION_DISTANCE) {
          const alpha = 1 - dist / CONNECTION_DISTANCE;
          const pulse =
            0.3 + 0.7 * Math.abs(Math.sin(t * 0.4 + i * 0.3 + j * 0.1));
          const finalAlpha = alpha * pulse * 0.35;

          // Each connection oscillates between green and red at its own phase
          const colorT = 0.5 + 0.5 * Math.sin(t * 0.25 + i * 0.7 + j * 0.4);
          const c = lerpColor(GREEN, RED, colorT);

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

/* ─── Data pulses (green + red traveling particles) */

function DataPulses(): ReactElement {
  // biome-ignore lint/style/noNonNullAssertion: three.js ref pattern
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  // biome-ignore lint/style/noNonNullAssertion: three.js ref pattern
  const colorRef = useRef<THREE.InstancedBufferAttribute>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const pulses = useMemo(
    () =>
      Array.from({ length: PULSE_COUNT }, () => ({
        startNode: Math.floor(Math.random() * NODE_COUNT),
        endNode: Math.floor(Math.random() * NODE_COUNT),
        progress: Math.random(),
        speed: 0.001 + Math.random() * 0.004,
        isGreen: Math.random() > 0.4, // 60% green, 40% red
      })),
    []
  );

  const positions = useMemo(() => {
    return Array.from({ length: NODE_COUNT }, () => [
      (Math.random() - 0.5) * BOUNDS.x * 2,
      (Math.random() - 0.5) * BOUNDS.y * 2,
      (Math.random() - 0.5) * BOUNDS.z * 2,
    ]);
  }, []);

  const velocities = useMemo(
    () =>
      Array.from({ length: NODE_COUNT }, () => [
        (Math.random() - 0.5) * 0.0012,
        (Math.random() - 0.5) * 0.0012,
        (Math.random() - 0.5) * 0.0008,
      ]),
    []
  );

  // Per-instance colors
  const colorArray = useMemo(() => new Float32Array(PULSE_COUNT * 3), []);

  useFrame(() => {
    for (let i = 0; i < NODE_COUNT; i++) {
      positions[i][0] += velocities[i][0];
      positions[i][1] += velocities[i][1];
      positions[i][2] += velocities[i][2];
      for (let axis = 0; axis < 3; axis++) {
        const bound = [BOUNDS.x, BOUNDS.y, BOUNDS.z][axis];
        if (Math.abs(positions[i][axis]) > bound) velocities[i][axis] *= -1;
      }
    }

    for (let i = 0; i < PULSE_COUNT; i++) {
      const p = pulses[i];
      p.progress += p.speed;

      if (p.progress > 1) {
        p.progress = 0;
        p.startNode = Math.floor(Math.random() * NODE_COUNT);
        p.endNode = Math.floor(Math.random() * NODE_COUNT);
        p.speed = 0.001 + Math.random() * 0.004;
        p.isGreen = Math.random() > 0.4;
      }

      const s = positions[p.startNode];
      const e = positions[p.endNode];
      const t = p.progress;

      dummy.position.set(
        s[0] + (e[0] - s[0]) * t,
        s[1] + (e[1] - s[1]) * t,
        s[2] + (e[2] - s[2]) * t
      );

      const scale = 0.5 + Math.sin(t * Math.PI) * 1.5;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Set color per pulse
      const c = p.isGreen ? GREEN : RED;
      colorArray[i * 3] = c.r;
      colorArray[i * 3 + 1] = c.g;
      colorArray[i * 3 + 2] = c.b;
    }
    meshRef.current.instanceMatrix.needsUpdate = true;

    if (colorRef.current) {
      colorRef.current.needsUpdate = true;
    }
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
        opacity={0.85}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}

/* ─── Floating nodes (dots at vertices) ─────────── */

function Nodes(): ReactElement {
  // biome-ignore lint/style/noNonNullAssertion: three.js ref pattern
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  // biome-ignore lint/style/noNonNullAssertion: three.js ref pattern
  const colorRef = useRef<THREE.InstancedBufferAttribute>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const positions = useMemo(() => {
    return Array.from({ length: NODE_COUNT }, () => [
      (Math.random() - 0.5) * BOUNDS.x * 2,
      (Math.random() - 0.5) * BOUNDS.y * 2,
      (Math.random() - 0.5) * BOUNDS.z * 2,
    ]);
  }, []);

  const velocities = useMemo(
    () =>
      Array.from({ length: NODE_COUNT }, () => [
        (Math.random() - 0.5) * 0.0012,
        (Math.random() - 0.5) * 0.0012,
        (Math.random() - 0.5) * 0.0008,
      ]),
    []
  );

  const colorArray = useMemo(() => new Float32Array(NODE_COUNT * 3), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

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

      dummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Each node slowly oscillates its own color
      const colorT = 0.5 + 0.5 * Math.sin(t * 0.15 + i * 1.2);
      const c = lerpColor(GREEN, RED, colorT);
      colorArray[i * 3] = c.r;
      colorArray[i * 3 + 1] = c.g;
      colorArray[i * 3 + 2] = c.b;
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
      <meshBasicMaterial vertexColors transparent opacity={0.7} />
    </instancedMesh>
  );
}

/* ─── Scene ─────────────────────────────────────── */

function Scene(): ReactElement {
  return (
    <>
      <Nodes />
      <Connections />
      <DataPulses />
    </>
  );
}

/* ─── Exported wrapper ──────────────────────────── */

export function NeuralNetworkBackground(): ReactElement {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="absolute inset-0" />;

  return (
    <div className="absolute inset-0 opacity-60">
      <Canvas
        camera={{ position: [0, 0, 7], fov: 60 }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, alpha: true }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
