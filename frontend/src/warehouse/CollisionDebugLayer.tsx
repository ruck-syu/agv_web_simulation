import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WAREHOUSE_LAYOUT } from '../config/warehouseConfig';
import { useSimulation } from '../simulation/SimulationProvider';
import { useViewport } from '../viewport/ViewportProvider';
import type { CollisionObstacle } from '../simulation/types';
import { collisionStyleFor } from './collisionStyles';

function addSegment(
  positions: number[],
  colors: number[],
  start: THREE.Vector3,
  end: THREE.Vector3,
  color: THREE.Color,
) {
  positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
  colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
}

function boxCorners(
  obstacle: CollisionObstacle,
): [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const cosine = Math.cos(obstacle.yaw);
  const sine = Math.sin(obstacle.yaw);
  const points: THREE.Vector3[] = [];
  for (const [localX, localY] of [
    [-obstacle.hx, -obstacle.hy],
    [obstacle.hx, -obstacle.hy],
    [obstacle.hx, obstacle.hy],
    [-obstacle.hx, obstacle.hy],
  ]) {
    const x = obstacle.cx + localX * cosine - localY * sine;
    const y = obstacle.cy + localX * sine + localY * cosine;
    points.push(new THREE.Vector3(x, 0, -y));
  }
  return [points[0], points[1], points[2], points[3]];
}

function appendBox(
  obstacle: CollisionObstacle,
  height: number,
  color: THREE.Color,
  positions: number[],
  colors: number[],
) {
  const zMin = Math.max(0.005, obstacle.zMin);
  const zMax = Math.max(zMin + 0.005, obstacle.zMax || height);
  const corners = boxCorners(obstacle);
  const bottom = corners.map((corner) => corner.clone().setY(zMin));
  const top = corners.map((corner) => corner.clone().setY(zMax));
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    addSegment(positions, colors, bottom[index], bottom[next], color);
    addSegment(positions, colors, top[index], top[next], color);
    addSegment(positions, colors, bottom[index], top[index], color);
  }
}

function appendCircle(
  obstacle: CollisionObstacle,
  height: number,
  color: THREE.Color,
  positions: number[],
  colors: number[],
) {
  const zMin = Math.max(0.005, obstacle.zMin);
  const zMax = Math.max(zMin + 0.005, obstacle.zMax || height);
  const segments = 24;
  const bottom: THREE.Vector3[] = [];
  const top: THREE.Vector3[] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    const x = obstacle.cx + Math.cos(angle) * obstacle.hx;
    const y = obstacle.cy + Math.sin(angle) * obstacle.hx;
    bottom.push(new THREE.Vector3(x, zMin, -y));
    top.push(new THREE.Vector3(x, zMax, -y));
  }
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    addSegment(positions, colors, bottom[index], bottom[next], color);
    addSegment(positions, colors, top[index], top[next], color);
    if (index % 6 === 0) {
      addSegment(positions, colors, bottom[index], top[index], color);
    }
  }
}

function appendObstacle(
  obstacle: CollisionObstacle,
  color: THREE.Color,
  positions: number[],
  colors: number[],
) {
  const style = collisionStyleFor(obstacle.type);
  if (obstacle.shape === 'circle') {
    appendCircle(obstacle, style.height, color, positions, colors);
  } else {
    appendBox(obstacle, style.height, color, positions, colors);
  }
}

export function CollisionDebugLayer() {
  const { snapshot, collisionGeometry, getLatestTelemetry } = useSimulation();
  const { collisionDebugVisible } = useViewport();
  const robotRef = useRef<THREE.Group>(null);
  const state = snapshot.collision.state;

  const obstacleGeometry = useMemo(() => {
    if (!collisionDebugVisible || !collisionGeometry) return null;
    const positions: number[] = [];
    const colors: number[] = [];
    for (const obstacle of collisionGeometry.obstacles) {
      const style = collisionStyleFor(obstacle.type);
      appendObstacle(obstacle, new THREE.Color(style.color), positions, colors);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  }, [collisionDebugVisible, collisionGeometry]);

  const blockedGeometry = useMemo(() => {
    if (!collisionDebugVisible || !collisionGeometry) return null;
    const blockedId = snapshot.collision.blockedObjectId;
    const blockedType = snapshot.collision.blockedObjectType;
    if (!blockedId) return null;
    const obstacle = collisionGeometry.obstacles.find(
      (item) =>
        item.id === blockedId && (!blockedType || item.type === blockedType),
    );
    if (!obstacle) return null;
    const positions: number[] = [];
    const colors: number[] = [];
    appendObstacle(obstacle, new THREE.Color('#ff4d4f'), positions, colors);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  }, [
    collisionDebugVisible,
    collisionGeometry,
    snapshot.collision.blockedObjectId,
    snapshot.collision.blockedObjectType,
  ]);

  const robotGeometry = useMemo(() => {
    const footprint = collisionGeometry?.robot ?? {
      footprintLength: WAREHOUSE_LAYOUT.agv.footprint.length,
      footprintWidth: WAREHOUSE_LAYOUT.agv.footprint.width,
      footprintPadding: WAREHOUSE_LAYOUT.agv.footprint.padding,
      height: WAREHOUSE_LAYOUT.agv.dimensions.height,
    };
    const halfLength = footprint.footprintLength * 0.5 + footprint.footprintPadding;
    const halfWidth = footprint.footprintWidth * 0.5 + footprint.footprintPadding;
    const positions: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color('#4ade80');
    const low = [
      new THREE.Vector3(halfLength, 0.04, -halfWidth),
      new THREE.Vector3(halfLength, 0.04, halfWidth),
      new THREE.Vector3(-halfLength, 0.04, halfWidth),
      new THREE.Vector3(-halfLength, 0.04, -halfWidth),
    ];
    const high = low.map((point) => point.clone().setY(footprint.height));
    for (let index = 0; index < 4; index += 1) {
      const next = (index + 1) % 4;
      addSegment(positions, colors, low[index], low[next], color);
      addSegment(positions, colors, high[index], high[next], color);
      addSegment(positions, colors, low[index], high[index], color);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  }, [collisionGeometry]);

  useFrame(() => {
    if (!robotRef.current) return;
    const telemetry = getLatestTelemetry();
    if (!telemetry) return;
    robotRef.current.position.set(telemetry.pose.x, 0, -telemetry.pose.y);
    robotRef.current.rotation.y = telemetry.pose.yaw;
  });

  if (!collisionDebugVisible) return null;

  const contactX = snapshot.collision.contactX;
  const contactY = snapshot.collision.contactY;

  return (
    <group renderOrder={20}>
      {obstacleGeometry && (
        <lineSegments geometry={obstacleGeometry} frustumCulled={false}>
          <lineBasicMaterial
            vertexColors
            transparent
            opacity={0.88}
            depthTest={false}
            depthWrite={false}
          />
        </lineSegments>
      )}
      {blockedGeometry && (
        <lineSegments geometry={blockedGeometry} frustumCulled={false}>
          <lineBasicMaterial
            vertexColors
            transparent
            opacity={1}
            depthTest={false}
            depthWrite={false}
          />
        </lineSegments>
      )}
      <group ref={robotRef}>
        <lineSegments geometry={robotGeometry} frustumCulled={false}>
          <lineBasicMaterial
            color={state === 'blocked' || state === 'contact' ? '#ff4d4f' : '#4ade80'}
            transparent
            opacity={1}
            depthTest={false}
            depthWrite={false}
          />
        </lineSegments>
      </group>
      {contactX !== null && contactY !== null && (
        <group position={[contactX, 0.11, -contactY]}>
          <mesh>
            <sphereGeometry args={[0.09, 16, 10]} />
            <meshBasicMaterial color="#ff4d4f" depthTest={false} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.075, 0]}>
            <ringGeometry args={[0.14, 0.2, 24]} />
            <meshBasicMaterial
              color="#ff4d4f"
              transparent
              opacity={0.75}
              side={THREE.DoubleSide}
              depthTest={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}
