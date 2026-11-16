import type { RackRowConfig } from '../config/warehouseConfig';
import { WAREHOUSE_LAYOUT } from '../config/warehouseConfig';

export interface PalletTransform {
  position: [number, number, number];
  rotationY: number;
}

export interface CartonTransform {
  position: [number, number, number];
  size: [number, number, number];
  rotationY: number;
  variant: number;
}

export interface LabelTransform {
  position: [number, number, number];
  rotationY: number;
  variant: number;
  size: [number, number];
}

export interface TapeTransform {
  position: [number, number, number];
  size: [number, number, number];
  rotationY: number;
}

export interface RackInventory {
  pallets: PalletTransform[];
  cartonsByVariant: [CartonTransform[], CartonTransform[], CartonTransform[]];
  labelsByVariant: [LabelTransform[], LabelTransform[], LabelTransform[]];
  tapes: TapeTransform[];
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRange(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

/**
 * Deterministic rack contents. Cartons, pallets and labels are generated once
 * per row so the scene is stable across renders. Nothing here is exported as
 * robot telemetry — it is static warehouse set dressing.
 */
export function generateRackInventory(row: RackRowConfig): RackInventory {
  const rack = WAREHOUSE_LAYOUT.rack;
  const random = mulberry32(hashSeed(`${row.id}-${row.label}-inventory`));

  const pallets: PalletTransform[] = [];
  const cartonsByVariant: [CartonTransform[], CartonTransform[], CartonTransform[]] = [[], [], []];
  const labelsByVariant: [LabelTransform[], LabelTransform[], LabelTransform[]] = [[], [], []];
  const tapes: TapeTransform[] = [];

  rack.beamLevels.forEach((beamLevel, levelIndex) => {
    const occupancy = levelIndex === 0 ? 0.9 : 0.82;

    for (let bay = 0; bay < rack.bays; bay += 1) {
      if (random() > occupancy) continue;

      const bayCenter = -rack.length / 2 + rack.bayWidth * (bay + 0.5);
      const useTwoPallets = random() > 0.18;
      const palletCenters = useTwoPallets ? [-0.62, 0.62] : [0];

      palletCenters.forEach((offset) => {
        const palletX = bayCenter + offset;
        const palletY = beamLevel + 0.145;
        pallets.push({
          position: [palletX, palletY, 0],
          rotationY: randomRange(random, -0.012, 0.012),
        });

        const palletTop = beamLevel + 0.225;
        const cellsX = [-0.27, 0.27];
        const cellsZ = [-0.185, 0.185];

        cellsX.forEach((cellX) => {
          cellsZ.forEach((cellZ) => {
            if (random() < 0.12) return;

            const cartonWidth = randomRange(random, 0.34, 0.5);
            const cartonDepth = randomRange(random, 0.285, 0.38);
            const cartonHeight = randomRange(random, 0.22, 0.33);
            const rotationY = randomRange(random, -0.045, 0.045);
            const variant = Math.min(2, Math.floor(random() * 3));

            const x = palletX + cellX + randomRange(random, -0.018, 0.018);
            const z = cellZ + randomRange(random, -0.014, 0.014);
            const y = palletTop + cartonHeight / 2;

            cartonsByVariant[variant].push({
              position: [x, y, z],
              size: [cartonWidth, cartonHeight, cartonDepth],
              rotationY,
              variant,
            });

            tapes.push({
              position: [x, y + cartonHeight / 2 + 0.0025, z],
              size: [Math.min(cartonWidth * 0.7, 0.32), 0.005, 0.065],
              rotationY,
            });

            const frontCell = cellZ * row.face > 0;
            if (frontCell && random() > 0.52) {
              const labelVariant = Math.min(2, Math.floor(random() * 3));
              const labelWidth = Math.min(0.26, cartonWidth * 0.56);
              const labelHeight = Math.min(0.18, cartonHeight * 0.54);
              const offset = cartonDepth / 2 + 0.0025;
              const direction = row.face;
              labelsByVariant[labelVariant].push({
                position: [
                  x + Math.sin(rotationY) * offset * direction,
                  y + randomRange(random, -0.01, 0.015),
                  z + Math.cos(rotationY) * offset * direction,
                ],
                rotationY: rotationY + (row.face === 1 ? 0 : Math.PI),
                variant: labelVariant,
                size: [labelWidth, labelHeight],
              });
            }

            if (random() > 0.62) {
              const secondHeight = randomRange(random, 0.18, 0.28);
              const secondWidth = cartonWidth * randomRange(random, 0.72, 0.94);
              const secondDepth = cartonDepth * randomRange(random, 0.74, 0.94);
              const secondRotation = rotationY + randomRange(random, -0.035, 0.035);
              const secondX = x + randomRange(random, -0.025, 0.025);
              const secondZ = z + randomRange(random, -0.02, 0.02);
              const secondY = y + cartonHeight / 2 + secondHeight / 2;
              const secondVariant = Math.min(2, Math.floor(random() * 3));

              cartonsByVariant[secondVariant].push({
                position: [secondX, secondY, secondZ],
                size: [secondWidth, secondHeight, secondDepth],
                rotationY: secondRotation,
                variant: secondVariant,
              });

              tapes.push({
                position: [secondX, secondY + secondHeight / 2 + 0.0025, secondZ],
                size: [Math.min(secondWidth * 0.7, 0.3), 0.005, 0.06],
                rotationY: secondRotation,
              });

              if (frontCell && random() > 0.58) {
                const labelVariant = Math.min(2, Math.floor(random() * 3));
                const offset = secondDepth / 2 + 0.0025;
                const secondLabelWidth = Math.min(0.24, secondWidth * 0.52);
                const secondLabelHeight = Math.min(0.16, secondHeight * 0.6);
                labelsByVariant[labelVariant].push({
                  position: [
                    secondX + Math.sin(secondRotation) * offset * row.face,
                    secondY + randomRange(random, -0.015, 0.012),
                    secondZ + Math.cos(secondRotation) * offset * row.face,
                  ],
                  rotationY: secondRotation + (row.face === 1 ? 0 : Math.PI),
                  variant: labelVariant,
                  size: [secondLabelWidth, secondLabelHeight],
                });
              }
            }
          });
        });
      });
    }
  });

  return { pallets, cartonsByVariant, labelsByVariant, tapes };
}
