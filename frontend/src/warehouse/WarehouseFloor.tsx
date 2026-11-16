import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { WAREHOUSE_LAYOUT } from '../config/warehouseConfig';
import {
  getAsphaltTexture,
  getConcreteTextures,
  getFloorArrowTexture,
  getFloorLabelTexture,
  getOilStainTexture,
} from './textures';
import { useInstancedTransforms, type InstanceTransform } from './instancing';

interface PaintSegment {
  x: number;
  z: number;
  length: number;
  width: number;
  rotationY?: number;
}

function line(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  width = 0.09,
): PaintSegment {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  const rotationY = -Math.atan2(dz, dx);
  return {
    x: (x1 + x2) / 2,
    z: (z1 + z2) / 2,
    length,
    width,
    rotationY,
  };
}

function rectangleLines(
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  thickness = 0.11,
): PaintSegment[] {
  const minX = centerX - width / 2;
  const maxX = centerX + width / 2;
  const minZ = centerZ - depth / 2;
  const maxZ = centerZ + depth / 2;
  return [
    line(minX, minZ, maxX, minZ, thickness),
    line(maxX, minZ, maxX, maxZ, thickness),
    line(maxX, maxZ, minX, maxZ, thickness),
    line(minX, maxZ, minX, minZ, thickness),
  ];
}

function buildFloorPaint() {
  const yellow: PaintSegment[] = [];
  const white: PaintSegment[] = [];
  const arrowPositions: {
    x: number;
    z: number;
    yaw: number;
    scale: number;
  }[] = [];

  const { aisles } = WAREHOUSE_LAYOUT;

  aisles.centers.forEach((centerZ) => {
    const halfWidth = aisles.width / 2 - 0.42;
    yellow.push(line(-23, centerZ - halfWidth, 1.2, centerZ - halfWidth, 0.075));
    yellow.push(line(-23, centerZ + halfWidth, 1.2, centerZ + halfWidth, 0.075));

    for (let x = -21.5; x < 0; x += 4.6) {
      yellow.push(line(x, centerZ, x + 2.15, centerZ, 0.085));
    }

    arrowPositions.push({ x: -19, z: centerZ, yaw: -Math.PI / 2, scale: 1 });
    arrowPositions.push({ x: -7.5, z: centerZ, yaw: -Math.PI / 2, scale: 1 });
  });

  yellow.push(line(1.9, -17, 1.9, 17, 0.1));
  yellow.push(line(6.9, -17, 6.9, 17, 0.1));
  for (let z = -16; z < 16; z += 4.8) {
    yellow.push(line(4.4, z, 4.4, z + 1.9, 0.095));
  }
  yellow.push(line(1.9, 15.8, 6.9, 15.8, 0.22));
  arrowPositions.push({ x: 4.4, z: 9.6, yaw: Math.PI, scale: 1.1 });
  arrowPositions.push({ x: 4.4, z: -9.2, yaw: 0, scale: 1.1 });

  WAREHOUSE_LAYOUT.docks.forEach((dock, index) => {
    yellow.push(...rectangleLines(dock.x, 16.6, 6.2, 4.8, 0.12));
    arrowPositions.push({ x: dock.x, z: 12.9, yaw: Math.PI, scale: 0.9 });
    if (index < 2) {
      white.push(line(dock.x - 3.1, 14.2, dock.x + 3.1, 14.2, 0.05));
    }
  });

  yellow.push(...rectangleLines(WAREHOUSE_LAYOUT.charging.x, WAREHOUSE_LAYOUT.charging.z, 7.2, 5.8, 0.12));

  yellow.push(line(29.4, -17.6, 29.4, 17.6, 0.09));
  yellow.push(line(31, -17.6, 31, 17.6, 0.09));
  for (let z = -17; z < 17; z += 3.4) {
    white.push(line(29.8, z, 30.6, z, 0.11));
  }

  return { yellow, white, arrowPositions };
}

function toTransforms(segments: PaintSegment[]): InstanceTransform[] {
  return segments.map((segment) => ({
    position: [segment.x, 0.015, segment.z],
    rotation: [0, segment.rotationY ?? 0, 0],
    scale: [segment.length, 0.008, segment.width],
  }));
}

function FloorLabel({
  title,
  subtitle,
  x,
  z,
  width,
  yaw = 0,
  tone = 'yellow',
}: {
  title: string;
  subtitle: string;
  x: number;
  z: number;
  width: number;
  yaw?: number;
  tone?: 'yellow' | 'white';
}) {
  const texture = useMemo(() => getFloorLabelTexture(title, subtitle, tone), [subtitle, title, tone]);
  const height = width * 0.375;

  return (
    <group position={[x, 0.019, z]} rotation={[0, yaw, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          map={texture}
          transparent
          opacity={0.88}
          roughness={0.93}
          metalness={0}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-3}
        />
      </mesh>
    </group>
  );
}

function LaneArrow({ x, z, yaw, scale }: { x: number; z: number; yaw: number; scale: number }) {
  const texture = useMemo(getFloorArrowTexture, []);
  return (
    <group position={[x, 0.021, z]} rotation={[0, yaw, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.15 * scale, 2.3 * scale]} />
        <meshStandardMaterial
          map={texture}
          transparent
          opacity={0.78}
          roughness={0.9}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-4}
        />
      </mesh>
    </group>
  );
}

export function WarehouseFloor() {
  const concrete = useMemo(() => getConcreteTextures(), []);
  const asphalt = useMemo(getAsphaltTexture, []);
  const oilStain = useMemo(getOilStainTexture, []);
  const floorPaint = useMemo(buildFloorPaint, []);

  const yellowRef = useRef<THREE.InstancedMesh | null>(null);
  const whiteRef = useRef<THREE.InstancedMesh | null>(null);
  const jointRef = useRef<THREE.InstancedMesh | null>(null);

  const yellowInstances = useMemo(() => toTransforms(floorPaint.yellow), [floorPaint.yellow]);
  const whiteInstances = useMemo(() => toTransforms(floorPaint.white), [floorPaint.white]);

  const jointInstances = useMemo(() => {
    const transforms: InstanceTransform[] = [];
    for (const x of [-24, -12, 0, 12, 24]) {
      transforms.push({
        position: [x, 0.008, 0],
        scale: [0.045, 0.006, WAREHOUSE_LAYOUT.dimensions.depth],
      });
    }
    for (const z of [-14, -6, 2, 10]) {
      transforms.push({
        position: [0, 0.008, z],
        scale: [WAREHOUSE_LAYOUT.dimensions.width, 0.006, 0.045],
      });
    }
    return transforms;
  }, []);

  useInstancedTransforms(yellowRef, yellowInstances);
  useInstancedTransforms(whiteRef, whiteInstances);
  useInstancedTransforms(jointRef, jointInstances);

  const { width, depth } = WAREHOUSE_LAYOUT.dimensions;

  return (
    <group>
      <mesh position={[0, -0.11, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[180, 130]} />
        <meshStandardMaterial map={asphalt} color="#777777" roughness={0.96} metalness={0.02} />
      </mesh>

      <mesh position={[0, -0.15, 0]} receiveShadow>
        <boxGeometry args={[width + 0.6, 0.3, depth + 0.6]} />
        <meshStandardMaterial color={WAREHOUSE_LAYOUT.floor.slabColor} roughness={0.9} />
      </mesh>

      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial
          map={concrete.map}
          roughnessMap={concrete.roughnessMap}
          bumpMap={concrete.bumpMap}
          bumpScale={0.022}
          color="#c1bdb0"
          roughness={0.9}
          metalness={0.02}
          envMapIntensity={0.45}
        />
      </mesh>

      <instancedMesh ref={jointRef} args={[undefined, undefined, jointInstances.length]} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#494943" roughness={0.96} />
      </instancedMesh>

      <instancedMesh ref={yellowRef} args={[undefined, undefined, yellowInstances.length]} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={WAREHOUSE_LAYOUT.floor.paintYellow} roughness={0.88} metalness={0.02} />
      </instancedMesh>

      <instancedMesh ref={whiteRef} args={[undefined, undefined, whiteInstances.length]} receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={WAREHOUSE_LAYOUT.floor.paintWhite} roughness={0.9} metalness={0.02} />
      </instancedMesh>

      {floorPaint.arrowPositions.map((arrow, index) => (
        <LaneArrow
          key={`arrow-${index}`}
          x={arrow.x}
          z={arrow.z}
          yaw={arrow.yaw}
          scale={arrow.scale}
        />
      ))}

      {WAREHOUSE_LAYOUT.docks.map((dock) => (
        <FloorLabel
          key={`dock-label-${dock.id}`}
          title={dock.label.replace(' ', ' · ')}
          subtitle={dock.subtitle}
          x={dock.x}
          z={16.4}
          width={4.4}
        />
      ))}

      <FloorLabel
        title="AGV · CHARGING"
        subtitle="KEEP BAY CLEAR"
        x={WAREHOUSE_LAYOUT.charging.x}
        z={WAREHOUSE_LAYOUT.charging.z}
        width={4.6}
      />
      <FloorLabel
        title="ENTRANCE"
        subtitle="AUTHORISED AGV TRAFFIC"
        x={26.7}
        z={-5.6}
        width={3.8}
        yaw={Math.PI / 2}
      />
      <FloorLabel
        title="EXIT"
        subtitle="OUTBOUND LANE"
        x={26.7}
        z={5.8}
        width={3.2}
        yaw={Math.PI / 2}
      />
      <FloorLabel
        title="AISLE · B"
        subtitle="AGV ONE-WAY LANE"
        x={-1}
        z={-1.6}
        width={3}
      />

      {[
        { x: -4.8, z: -6.9, scale: 5.2 },
        { x: 15.4, z: 12.5, scale: 3.7 },
        { x: 23.7, z: 2.4, scale: 4.4 },
        { x: -18.5, z: 9.1, scale: 3.2 },
      ].map((stain, index) => (
        <mesh
          key={`oil-${index}`}
          position={[stain.x, 0.017, stain.z]}
          rotation={[-Math.PI / 2, 0, index * 0.7]}
        >
          <planeGeometry args={[stain.scale, stain.scale * 0.58]} />
          <meshStandardMaterial
            map={oilStain}
            transparent
            opacity={0.6}
            roughness={1}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
