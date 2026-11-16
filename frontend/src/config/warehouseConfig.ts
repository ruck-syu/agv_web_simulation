export type Vec3Tuple = [number, number, number];
export type CameraView = 'overview' | 'racks' | 'agv';

export interface CameraPreset {
  label: string;
  description: string;
  position: Vec3Tuple;
  target: Vec3Tuple;
}

export interface RackRowConfig {
  id: string;
  label: string;
  aisleSide: string;
  x: number;
  z: number;
  face: 1 | -1;
}

export interface DockConfig {
  id: string;
  x: number;
  z: number;
  label: string;
  subtitle: string;
}

const RACK_LENGTH = 24;
const RACK_DEPTH = 1.2;
const RACK_HEIGHT = 6.6;
const RACK_BAYS = 8;
const RACK_BAY_WIDTH = RACK_LENGTH / RACK_BAYS;
const RACK_X = -12;
const BLOCK_CENTERS = [-13, -5.4, 2.2, 9.8];
const ROW_OFFSET = 0.62;
const BLOCK_NAMES = ['A', 'B', 'C', 'D'];

const rackRows: RackRowConfig[] = BLOCK_CENTERS.flatMap((center, index) => {
  const block = BLOCK_NAMES[index];
  return [
    {
      id: `${block}1`,
      label: `RACK ${block}-01`,
      aisleSide: 'North face',
      x: RACK_X,
      z: center - ROW_OFFSET,
      face: -1 as const,
    },
    {
      id: `${block}2`,
      label: `RACK ${block}-02`,
      aisleSide: 'South face',
      x: RACK_X,
      z: center + ROW_OFFSET,
      face: 1 as const,
    },
  ];
});

export const WAREHOUSE_LAYOUT = {
  dimensions: {
    width: 64,
    depth: 40,
    wallHeight: 10.2,
    slabThickness: 0.3,
  },
  floor: {
    slabColor: '#5b5b55',
    paintYellow: '#b8962f',
    paintWhite: '#b9b5a4',
  },
  rack: {
    length: RACK_LENGTH,
    depth: RACK_DEPTH,
    height: RACK_HEIGHT,
    bays: RACK_BAYS,
    bayWidth: RACK_BAY_WIDTH,
    upright: 0.1,
    beamLevels: [1.25, 2.6, 3.95, 5.3],
    beamHeight: 0.13,
    beamDepth: 0.06,
    x: RACK_X,
    rows: rackRows,
    colors: {
      upright: '#1f4f7f',
      uprightDark: '#173a5e',
      beam: '#d27324',
      deck: '#3c4147',
      footplate: '#262a2f',
      guard: '#c5a12f',
    },
  },
  aisles: {
    centers: [-9.2, -1.6, 6.0],
    crossCenterX: 4.4,
    width: 5.16,
  },
  docks: [
    { id: 'dock-01', x: 11, z: 19.55, label: 'DOCK 01', subtitle: 'INBOUND' },
    { id: 'dock-02', x: 19, z: 19.55, label: 'DOCK 02', subtitle: 'INBOUND' },
    { id: 'dock-03', x: 27, z: 19.55, label: 'DOCK 03', subtitle: 'OUTBOUND' },
  ] satisfies DockConfig[],
  charging: {
    x: 25.5,
    z: -14.6,
    heading: Math.PI,
  },
  agv: {
    id: 'AGV-07',
    spawn: [-2.8, 0, -1.6] as Vec3Tuple,
    heading: 0,
    dimensions: {
      length: 1.52,
      width: 0.92,
      height: 0.96,
    },
    wheelRadius: 0.19,
    wheelSeparation: 0.94,
    wheelPositions: {
      leftZ: -0.47,
      rightZ: 0.47,
      y: 0.19,
    },
    footprint: {
      length: 1.55,
      width: 1.06,
      padding: 0,
    },
  },
  cameraPresets: {
    overview: {
      label: 'Overview',
      description: 'Complete warehouse',
      position: [35, 21, 29],
      target: [-4, 1.8, -1],
    },
    racks: {
      label: 'Racks',
      description: 'Aisle B storage detail',
      position: [7.5, 4.8, 10.8],
      target: [-12, 3.2, 1.8],
    },
    agv: {
      label: 'AGV',
      description: 'AGV-07 in aisle B',
      position: [1.9, 1.38, 0.52],
      target: [-2.8, 0.62, -1.6],
    },
  } satisfies Record<CameraView, CameraPreset>,
} as const;

export const RACK_BLOCK_CENTERS = BLOCK_CENTERS;
