import { Suspense, useEffect, useRef, type ElementRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { WAREHOUSE_LAYOUT } from '../config/warehouseConfig';
import { useSimulation } from '../simulation/SimulationProvider';
import type { CollisionObstacle } from '../simulation/types';
import { useViewport, type CameraMode } from '../viewport/ViewportProvider';
import { collisionStyleFor } from './collisionStyles';
import { WarehouseScene } from './WarehouseScene';

type OrbitControlsHandle = ElementRef<typeof OrbitControls>;

const FOLLOW_TARGET_HEIGHT = 0.58;
const MIN_CAMERA_HEIGHT = 0.92;
const WAREHOUSE_SPAN = Math.hypot(
  WAREHOUSE_LAYOUT.dimensions.width,
  WAREHOUSE_LAYOUT.dimensions.depth,
);
const MIN_CAMERA_DISTANCE = 1.35;
const MAX_CAMERA_DISTANCE = WAREHOUSE_SPAN * 1.9;

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function moveOutOfCircle(
  position: THREE.Vector3,
  obstacle: CollisionObstacle,
  margin: number,
): boolean {
  const dx = position.x - obstacle.cx;
  const dy = -position.z - obstacle.cy;
  const radius = obstacle.hx + margin;
  const distance = Math.hypot(dx, dy);
  if (distance >= radius) return false;
  if (distance < 1e-6) {
    position.x = obstacle.cx + radius;
    position.z = -obstacle.cy;
    return true;
  }
  const scale = radius / distance;
  position.x = obstacle.cx + dx * scale;
  position.z = -(obstacle.cy + dy * scale);
  return true;
}

function moveOutOfBox(
  position: THREE.Vector3,
  obstacle: CollisionObstacle,
  margin: number,
): boolean {
  const cosine = Math.cos(obstacle.yaw);
  const sine = Math.sin(obstacle.yaw);
  const dx = position.x - obstacle.cx;
  const dy = -position.z - obstacle.cy;
  const localX = dx * cosine + dy * sine;
  const localY = -dx * sine + dy * cosine;
  const halfX = obstacle.hx + margin;
  const halfY = obstacle.hy + margin;
  if (Math.abs(localX) >= halfX || Math.abs(localY) >= halfY) return false;

  const pushX = halfX - Math.abs(localX);
  const pushY = halfY - Math.abs(localY);
  let resolvedX = localX;
  let resolvedY = localY;
  if (pushX < pushY) {
    resolvedX = Math.sign(localX || 1) * halfX;
  } else {
    resolvedY = Math.sign(localY || 1) * halfY;
  }
  position.x = obstacle.cx + resolvedX * cosine - resolvedY * sine;
  position.z = -(obstacle.cy + resolvedX * sine + resolvedY * cosine);
  return true;
}

function keepCameraClear(
  position: THREE.Vector3,
  mode: CameraMode,
  obstacles: CollisionObstacle[] | null,
) {
  position.y = Math.max(position.y, MIN_CAMERA_HEIGHT);
  if (mode !== 'overview' && obstacles) {
    for (const obstacle of obstacles) {
      const clearance = collisionStyleFor(obstacle.type).height + 0.42;
      if (position.y >= clearance) continue;
      if (obstacle.shape === 'circle') {
        moveOutOfCircle(position, obstacle, 0.28);
      } else {
        moveOutOfBox(position, obstacle, 0.28);
      }
    }
    position.y = Math.max(position.y, MIN_CAMERA_HEIGHT);
  }
}

function CameraRig() {
  const { camera } = useThree();
  const { getLatestTelemetry, collisionGeometry } = useSimulation();
  const { mode, command } = useViewport();
  const controlsRef = useRef<OrbitControlsHandle>(null);
  const transitioning = useRef(false);
  const progress = useRef(1);
  const fromPosition = useRef(new THREE.Vector3());
  const fromTarget = useRef(new THREE.Vector3());
  const toPosition = useRef(new THREE.Vector3());
  const toTarget = useRef(new THREE.Vector3());
  const followTarget = useRef(new THREE.Vector3());

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.set(...WAREHOUSE_LAYOUT.cameraPresets.overview.target);
    controls.update();
  }, []);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || command.token === 0) return;

    const destination = new THREE.Vector3();
    const destinationTarget = new THREE.Vector3();

    if (command.type === 'overview' || command.type === 'racks') {
      const preset =
        WAREHOUSE_LAYOUT.cameraPresets[command.type === 'racks' ? 'racks' : 'overview'];
      destination.set(...preset.position);
      destinationTarget.set(...preset.target);
    } else {
      const telemetry = getLatestTelemetry();
      if (!telemetry) return;
      destinationTarget.set(telemetry.pose.x, FOLLOW_TARGET_HEIGHT, -telemetry.pose.y);
      const offset = camera.position.clone().sub(controls.target);
      const horizontal = new THREE.Vector3(offset.x, 0, offset.z);
      if (horizontal.lengthSq() < 0.01) horizontal.set(1, 0, 1);
      horizontal.normalize();

      if (command.type === 'close') {
        const distance = 4.2;
        destination
          .copy(destinationTarget)
          .addScaledVector(horizontal, distance)
          .setY(destinationTarget.y + 2.65);
      } else if (command.type === 'focus') {
        const distance = 6.4;
        destination
          .copy(destinationTarget)
          .addScaledVector(horizontal, distance)
          .setY(destinationTarget.y + 3.35);
      } else {
        const distance = clamp(offset.length(), 8, 12);
        destination
          .copy(destinationTarget)
          .addScaledVector(horizontal, distance)
          .setY(destinationTarget.y + Math.max(3.6, distance * 0.44));
      }
    }

    fromPosition.current.copy(camera.position);
    fromTarget.current.copy(controls.target);
    toPosition.current.copy(destination);
    toTarget.current.copy(destinationTarget);
    progress.current = 0;
    transitioning.current = true;
  }, [camera, command, getLatestTelemetry]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const step = Math.min(delta, 0.1);
    const obstacles = collisionGeometry?.obstacles ?? null;

    if (transitioning.current) {
      progress.current = Math.min(1, progress.current + delta / 0.95);
      const eased = easeInOutCubic(progress.current);
      camera.position.lerpVectors(fromPosition.current, toPosition.current, eased);
      controls.target.lerpVectors(fromTarget.current, toTarget.current, eased);
      keepCameraClear(camera.position, mode, obstacles);
      controls.update();
      if (progress.current >= 1) transitioning.current = false;
      return;
    }

    if (mode === 'overview') return;

    const telemetry = getLatestTelemetry();
    if (!telemetry) return;

    followTarget.current.set(telemetry.pose.x, FOLLOW_TARGET_HEIGHT, -telemetry.pose.y);
    const blend = 1 - Math.exp(-7 * step);
    const previousTarget = controls.target.clone();
    controls.target.lerp(followTarget.current, blend);
    camera.position.add(controls.target.clone().sub(previousTarget));
    keepCameraClear(camera.position, mode, obstacles);
    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={MIN_CAMERA_DISTANCE}
      maxDistance={MAX_CAMERA_DISTANCE}
      minPolarAngle={0.05}
      maxPolarAngle={1.42}
      enablePan={mode === 'overview'}
      panSpeed={0.9}
      screenSpacePanning
      zoomToCursor
      onStart={() => {
        transitioning.current = false;
      }}
    />
  );
}

export function WarehouseCanvas() {
  return (
    <Canvas
      className="warehouse-canvas"
      shadows="soft"
      dpr={[1, 1.75]}
      camera={{
        position: WAREHOUSE_LAYOUT.cameraPresets.overview.position,
        fov: 42,
        near: 0.08,
        far: 320,
      }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.04;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
    >
      <color attach="background" args={['#11161a']} />
      <fog attach="fog" args={['#12181c', 62, 145]} />
      <Suspense fallback={null}>
        <WarehouseScene />
      </Suspense>
      <CameraRig />
    </Canvas>
  );
}
