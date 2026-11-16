import * as THREE from 'three';

type Tone = 'yellow' | 'white';

const textureCache = new Map<string, THREE.Texture>();

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context is unavailable.');
  return context;
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

function makeTexture(
  canvas: HTMLCanvasElement,
  repeatX = 1,
  repeatY = 1,
  colorTexture = true,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = colorTexture ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function cached(key: string, factory: () => THREE.Texture): THREE.Texture {
  const existing = textureCache.get(key);
  if (existing) return existing;
  const texture = factory();
  textureCache.set(key, texture);
  return texture;
}

function speckle(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  random: () => number,
  count: number,
  alpha: number,
  light: boolean,
  maxSize = 2.5,
): void {
  for (let index = 0; index < count; index += 1) {
    const value = light ? 255 : 0;
    context.fillStyle = `rgba(${value}, ${value}, ${value}, ${alpha * (0.2 + random() * 0.8)})`;
    const size = 0.4 + random() * maxSize;
    context.fillRect(random() * width, random() * height, size, size);
  }
}

function drawConcreteCanvas(seed: number): HTMLCanvasElement {
  const canvas = createCanvas(1024, 1024);
  const context = context2d(canvas);
  const random = mulberry32(seed);

  context.fillStyle = '#7a7a72';
  context.fillRect(0, 0, 1024, 1024);

  for (let index = 0; index < 60; index += 1) {
    const x = random() * 1024;
    const y = random() * 1024;
    const radius = 40 + random() * 220;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    const dark = random() > 0.45;
    gradient.addColorStop(0, dark ? 'rgba(44, 43, 38, 0.09)' : 'rgba(215, 212, 198, 0.07)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  speckle(context, 1024, 1024, random, 16000, 0.11, false, 2);
  speckle(context, 1024, 1024, random, 8000, 0.1, true, 1.8);

  context.lineCap = 'round';
  for (let index = 0; index < 14; index += 1) {
    let x = random() * 1024;
    let y = random() * 1024;
    context.strokeStyle = `rgba(35, 34, 31, ${0.12 + random() * 0.15})`;
    context.lineWidth = 0.6 + random() * 1.4;
    context.beginPath();
    context.moveTo(x, y);
    const segments = 4 + Math.floor(random() * 7);
    for (let step = 0; step < segments; step += 1) {
      x += (random() - 0.5) * 80;
      y += (random() - 0.5) * 65;
      context.lineTo(x, y);
    }
    context.stroke();
  }

  for (let index = 0; index < 22; index += 1) {
    const x = random() * 1024;
    const y = random() * 1024;
    const width = 10 + random() * 120;
    context.strokeStyle = `rgba(25, 25, 22, ${0.025 + random() * 0.05})`;
    context.lineWidth = 3 + random() * 13;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + width, y + (random() - 0.5) * 10);
    context.stroke();
  }

  return canvas;
}

function drawBumpCanvas(seed: number): HTMLCanvasElement {
  const canvas = createCanvas(512, 512);
  const context = context2d(canvas);
  const random = mulberry32(seed);
  context.fillStyle = '#858585';
  context.fillRect(0, 0, 512, 512);

  for (let index = 0; index < 4000; index += 1) {
    const value = 80 + Math.floor(random() * 100);
    context.fillStyle = `rgba(${value}, ${value}, ${value}, 0.2)`;
    const size = 0.5 + random() * 3;
    context.fillRect(random() * 512, random() * 512, size, size);
  }

  for (let index = 0; index < 40; index += 1) {
    const x = random() * 512;
    const y = random() * 512;
    const radius = 20 + random() * 80;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, random() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  return canvas;
}

export function getConcreteTextures() {
  const map = cached('concrete-map', () => makeTexture(drawConcreteCanvas(2), 6, 4, true));
  const roughnessMap = cached('concrete-rough', () =>
    makeTexture(drawBumpCanvas(7), 6, 4, false),
  );
  const bumpMap = cached('concrete-bump', () => makeTexture(drawBumpCanvas(12), 6, 4, false));
  return { map, roughnessMap, bumpMap };
}

export function getAsphaltTexture(): THREE.Texture {
  return cached('asphalt', () => {
    const canvas = createCanvas(512, 512);
    const context = context2d(canvas);
    const random = mulberry32(21);
    context.fillStyle = '#303335';
    context.fillRect(0, 0, 512, 512);
    speckle(context, 512, 512, random, 9000, 0.18, true, 1.6);
    speckle(context, 512, 512, random, 6000, 0.16, false, 1.4);
    context.strokeStyle = 'rgba(15, 16, 17, 0.28)';
    context.lineWidth = 1;
    for (let index = 0; index < 15; index += 1) {
      let x = random() * 512;
      let y = random() * 512;
      context.beginPath();
      context.moveTo(x, y);
      for (let step = 0; step < 3; step += 1) {
        x += (random() - 0.5) * 70;
        y += 20 + random() * 40;
        context.lineTo(x, y);
      }
      context.stroke();
    }
    return makeTexture(canvas, 12, 9, true);
  });
}

export function getCorrugatedWallTexture(repeatX: number): THREE.Texture {
  return cached(`corrugated-${repeatX}`, () => {
    const width = 768;
    const height = 512;
    const canvas = createCanvas(width, height);
    const context = context2d(canvas);
    const random = mulberry32(31);
    const base = context.createLinearGradient(0, 0, 0, height);
    base.addColorStop(0, '#777d80');
    base.addColorStop(0.55, '#666c70');
    base.addColorStop(1, '#555b5f');
    context.fillStyle = base;
    context.fillRect(0, 0, width, height);

    const period = 48;
    for (let x = -period; x < width + period; x += period) {
      const rib = context.createLinearGradient(x, 0, x + period, 0);
      rib.addColorStop(0, 'rgba(20, 23, 25, 0.24)');
      rib.addColorStop(0.18, 'rgba(255,255,255,0.13)');
      rib.addColorStop(0.46, 'rgba(255,255,255,0.02)');
      rib.addColorStop(0.62, 'rgba(0,0,0,0.13)');
      rib.addColorStop(1, 'rgba(15,17,18,0.25)');
      context.fillStyle = rib;
      context.fillRect(x, 0, period, height);
    }

    for (let index = 0; index < 10; index += 1) {
      const x = 40 + random() * (width - 80);
      const stain = context.createLinearGradient(x, height * 0.35, x, height);
      stain.addColorStop(0, 'rgba(42, 33, 24, 0)');
      stain.addColorStop(1, `rgba(42, 33, 24, ${0.04 + random() * 0.09})`);
      context.fillStyle = stain;
      context.fillRect(x, height * 0.35, 4 + random() * 20, height * 0.65);
    }

    for (let index = 0; index < 22; index += 1) {
      context.strokeStyle = `rgba(25, 27, 27, ${0.05 + random() * 0.1})`;
      context.lineWidth = 0.6 + random();
      const x = random() * width;
      const y = random() * height;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + 20 + random() * 80, y + (random() - 0.5) * 12);
      context.stroke();
    }

    context.strokeStyle = 'rgba(24, 27, 28, 0.32)';
    context.lineWidth = 3;
    for (let x = 0; x <= width; x += period * 4) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }

    return makeTexture(canvas, repeatX, 1, true);
  });
}

export function getWoodTexture(): THREE.Texture {
  return cached('pallet-wood', () => {
    const canvas = createCanvas(512, 512);
    const context = context2d(canvas);
    const random = mulberry32(42);
    context.fillStyle = '#a47c50';
    context.fillRect(0, 0, 512, 512);

    const plankHeight = 64;
    for (let y = 0; y < 512; y += plankHeight) {
      const offset = (Math.floor(y / plankHeight) % 2) * 45;
      context.fillStyle = `rgba(80, 48, 22, ${0.06 + random() * 0.08})`;
      context.fillRect(0, y + plankHeight - 2, 512, 2);
      for (let index = 0; index < 8; index += 1) {
        const x = offset - 100 + random() * 700;
        context.strokeStyle = `rgba(67, 42, 20, ${0.04 + random() * 0.1})`;
        context.lineWidth = 0.5 + random() * 1.4;
        context.beginPath();
        context.moveTo(x, y + 4);
        context.bezierCurveTo(
          x + 45,
          y + 10 + random() * 25,
          x + 130,
          y + 20 + random() * 30,
          x + 250 + random() * 180,
          y + 6 + random() * 50,
        );
        context.stroke();
      }
    }

    speckle(context, 512, 512, random, 1800, 0.06, false, 1.2);
    return makeTexture(canvas, 1, 1, true);
  });
}

export function getCardboardTexture(): THREE.Texture {
  return cached('cardboard', () => {
    const canvas = createCanvas(512, 512);
    const context = context2d(canvas);
    const random = mulberry32(53);
    context.fillStyle = '#c9a875';
    context.fillRect(0, 0, 512, 512);

    for (let index = 0; index < 1900; index += 1) {
      const light = random() > 0.55;
      context.fillStyle = light
        ? `rgba(244, 219, 170, ${0.05 + random() * 0.06})`
        : `rgba(96, 67, 34, ${0.03 + random() * 0.055})`;
      const size = 0.6 + random() * 2.6;
      context.fillRect(random() * 512, random() * 512, size, size);
    }

    for (let index = 0; index < 22; index += 1) {
      context.strokeStyle = `rgba(110, 78, 40, ${0.025 + random() * 0.05})`;
      context.lineWidth = 0.6 + random();
      const y = random() * 512;
      context.beginPath();
      context.moveTo(0, y);
      for (let x = 0; x <= 512; x += 64) {
        context.lineTo(x, y + (random() - 0.5) * 4);
      }
      context.stroke();
    }

    const edge = context.createLinearGradient(0, 0, 0, 512);
    edge.addColorStop(0, 'rgba(60, 40, 20, 0.10)');
    edge.addColorStop(0.06, 'rgba(60, 40, 20, 0)');
    edge.addColorStop(0.94, 'rgba(60, 40, 20, 0)');
    edge.addColorStop(1, 'rgba(60, 40, 20, 0.13)');
    context.fillStyle = edge;
    context.fillRect(0, 0, 512, 512);

    return makeTexture(canvas, 1, 1, true);
  });
}

export function getShippingLabelTexture(variant: number): THREE.Texture {
  return cached(`shipping-label-${variant}`, () => {
    const canvas = createCanvas(384, 256);
    const context = context2d(canvas);
    const random = mulberry32(80 + variant);
    context.fillStyle = '#f2efe6';
    context.fillRect(0, 0, 384, 256);
    context.strokeStyle = '#b9b3a6';
    context.lineWidth = 4;
    context.strokeRect(2, 2, 380, 252);

    context.fillStyle = '#24262a';
    context.font = '700 20px Arial, sans-serif';
    context.fillText('NORTHRIDGE LOGISTICS', 20, 35);
    context.font = '700 36px Arial, sans-serif';
    context.fillText(`WMS-${variant === 0 ? '041' : variant === 1 ? '087' : '112'}`, 20, 82);
    context.font = '500 16px Arial, sans-serif';
    context.fillStyle = '#44474b';
    context.fillText('SHIP TO: DC-ALPHA / INBOUND', 20, 110);
    context.fillText(`PALLET ${Math.floor(10 + random() * 80)} · LOT ${Math.floor(1000 + random() * 8000)}`, 20, 134);

    context.fillStyle = '#1f2124';
    let x = 20;
    while (x < 360) {
      const barWidth = 1 + Math.floor(random() * 5);
      context.fillRect(x, 164, barWidth, 50);
      x += barWidth + 2 + Math.floor(random() * 3);
    }
    context.font = '500 14px monospace';
    context.fillStyle = '#3c3f42';
    context.fillText(`AGV-WEB-${variant + 1}${Math.floor(random() * 9000 + 1000)}`, 20, 239);

    context.fillStyle = 'rgba(95, 78, 45, 0.08)';
    for (let index = 0; index < 12; index += 1) {
      context.fillRect(random() * 384, random() * 256, 4 + random() * 24, 2 + random() * 5);
    }

    return makeTexture(canvas, 1, 1, true);
  });
}

export function getRackSignTexture(label: string, line: string): THREE.Texture {
  return cached(`rack-sign-${label}-${line}`, () => {
    const canvas = createCanvas(1024, 256);
    const context = context2d(canvas);
    context.fillStyle = '#171d23';
    context.fillRect(0, 0, 1024, 256);
    context.fillStyle = '#d18a2f';
    context.fillRect(0, 0, 38, 256);
    context.strokeStyle = '#4b5560';
    context.lineWidth = 5;
    context.strokeRect(10, 10, 1004, 236);

    context.fillStyle = '#f1e8d4';
    context.font = '800 86px Arial, sans-serif';
    context.fillText(label, 84, 118);
    context.fillStyle = '#8e9aa4';
    context.font = '600 30px Arial, sans-serif';
    context.fillText(line, 88, 174);
    context.fillStyle = '#d18a2f';
    context.fillRect(86, 200, 300, 7);
    context.fillStyle = '#8e9aa4';
    context.font = '600 22px Arial, sans-serif';
    context.fillText('SELECTIVE PALLET RACKING', 88, 232);

    return makeTexture(canvas, 1, 1, true);
  });
}

export function getDockSignTexture(label: string, subtitle: string): THREE.Texture {
  return cached(`dock-sign-${label}-${subtitle}`, () => {
    const canvas = createCanvas(1024, 256);
    const context = context2d(canvas);
    context.fillStyle = '#20262c';
    context.fillRect(0, 0, 1024, 256);
    context.fillStyle = '#c69f35';
    context.fillRect(0, 0, 1024, 12);
    context.strokeStyle = '#525b63';
    context.lineWidth = 4;
    context.strokeRect(10, 22, 1004, 224);
    context.fillStyle = '#f2eee2';
    context.font = '800 92px Arial, sans-serif';
    context.fillText(label, 54, 132);
    context.fillStyle = '#e4b85a';
    context.font = '700 32px Arial, sans-serif';
    context.fillText(subtitle, 58, 188);
    context.fillStyle = '#87929b';
    context.font = '600 22px Arial, sans-serif';
    context.fillText('AGV TRAFFIC — KEEP CLEAR', 58, 225);
    return makeTexture(canvas, 1, 1, true);
  });
}

export function getFloorLabelTexture(
  title: string,
  subtitle: string,
  tone: Tone = 'yellow',
): THREE.Texture {
  return cached(`floor-label-${title}-${subtitle}-${tone}`, () => {
    const canvas = createCanvas(1024, 384);
    const context = context2d(canvas);
    const random = mulberry32(title.length * 91 + subtitle.length * 17);
    const color = tone === 'yellow' ? '#c7a43a' : '#bcb8a9';
    const faded = tone === 'yellow' ? 'rgba(199, 164, 58, 0.75)' : 'rgba(188, 184, 169, 0.7)';

    context.clearRect(0, 0, 1024, 384);
    context.strokeStyle = faded;
    context.lineWidth = 8;
    context.strokeRect(16, 16, 992, 352);
    context.fillStyle = faded;
    context.fillRect(16, 16, 992, 13);
    context.fillRect(16, 355, 992, 13);

    context.fillStyle = faded;
    context.textAlign = 'center';
    context.font = '900 132px Arial, sans-serif';
    context.fillText(title, 512, 190);
    context.font = '700 44px Arial, sans-serif';
    context.fillText(subtitle, 512, 286);

    context.fillStyle = color;
    context.fillRect(368, 306, 288, 8);

    context.globalCompositeOperation = 'destination-out';
    for (let index = 0; index < 450; index += 1) {
      context.fillStyle = `rgba(0,0,0,${0.04 + random() * 0.18})`;
      const size = 0.5 + random() * 5;
      context.fillRect(random() * 1024, random() * 384, size, size);
    }
    context.globalCompositeOperation = 'source-over';

    return makeTexture(canvas, 1, 1, true);
  });
}

export function getFloorArrowTexture(): THREE.Texture {
  return cached('floor-arrow', () => {
    const canvas = createCanvas(256, 512);
    const context = context2d(canvas);
    context.clearRect(0, 0, 256, 512);
    context.fillStyle = 'rgba(193, 158, 48, 0.86)';
    context.beginPath();
    context.moveTo(128, 28);
    context.lineTo(220, 205);
    context.lineTo(164, 205);
    context.lineTo(164, 420);
    context.lineTo(92, 420);
    context.lineTo(92, 205);
    context.lineTo(36, 205);
    context.closePath();
    context.fill();
    context.fillStyle = 'rgba(35, 38, 40, 0.68)';
    context.font = '800 42px Arial, sans-serif';
    context.textAlign = 'center';
    context.fillText('AGV', 128, 485);
    return makeTexture(canvas, 1, 1, true);
  });
}

export function getHazardStripeTexture(): THREE.Texture {
  return cached('hazard-stripes', () => {
    const canvas = createCanvas(256, 256);
    const context = context2d(canvas);
    context.fillStyle = '#c3a034';
    context.fillRect(0, 0, 256, 256);
    context.strokeStyle = '#1f2326';
    context.lineWidth = 52;
    for (let offset = -256; offset < 512; offset += 104) {
      context.beginPath();
      context.moveTo(offset, 0);
      context.lineTo(offset + 256, 256);
      context.stroke();
    }
    const random = mulberry32(93);
    for (let index = 0; index < 80; index += 1) {
      context.fillStyle = `rgba(0,0,0,${0.03 + random() * 0.08})`;
      context.fillRect(random() * 256, random() * 256, 1 + random() * 8, 1 + random() * 4);
    }
    return makeTexture(canvas, 2, 1, true);
  });
}

export function getAgvDecalTexture(): THREE.Texture {
  return cached('agv-decal', () => {
    const canvas = createCanvas(512, 128);
    const context = context2d(canvas);
    context.clearRect(0, 0, 512, 128);
    context.fillStyle = '#f5f1e8';
    context.font = '900 62px Arial, sans-serif';
    context.fillText('AGV-07', 18, 66);
    context.fillStyle = '#2a2e32';
    context.font = '700 19px Arial, sans-serif';
    context.fillText('AUTONOMOUS MOBILE ROBOT', 20, 98);
    context.fillStyle = '#d4932f';
    context.fillRect(382, 36, 106, 12);
    context.fillRect(382, 57, 70, 8);
    return makeTexture(canvas, 1, 1, true);
  });
}

export function getWallSignTexture(): THREE.Texture {
  return cached('wall-sign', () => {
    const canvas = createCanvas(1536, 256);
    const context = context2d(canvas);
    context.clearRect(0, 0, 1536, 256);
    context.fillStyle = 'rgba(20, 25, 29, 0.9)';
    context.fillRect(0, 0, 1536, 256);
    context.fillStyle = '#d29a38';
    context.fillRect(0, 0, 24, 256);
    context.strokeStyle = '#57616a';
    context.lineWidth = 4;
    context.strokeRect(38, 18, 1462, 220);
    context.fillStyle = '#e9e3d5';
    context.font = '800 80px Arial, sans-serif';
    context.fillText('NORTHRIDGE LOGISTICS', 80, 125);
    context.fillStyle = '#9ba5ad';
    context.font = '600 34px Arial, sans-serif';
    context.fillText('INBOUND DISTRIBUTION CENTRE · BAY 01–02', 84, 180);
    context.fillStyle = '#d29a38';
    context.font = '700 26px Arial, sans-serif';
    context.fillText('AUTHORISED PERSONNEL ONLY', 984, 222);
    return makeTexture(canvas, 1, 1, true);
  });
}

export function getOilStainTexture(): THREE.Texture {
  return cached('oil-stain', () => {
    const canvas = createCanvas(256, 256);
    const context = context2d(canvas);
    const random = mulberry32(111);
    context.clearRect(0, 0, 256, 256);
    for (let index = 0; index < 50; index += 1) {
      const x = 48 + random() * 160;
      const y = 48 + random() * 160;
      const radius = 12 + random() * 52;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(21, 21, 18, ${0.06 + random() * 0.1})`);
      gradient.addColorStop(1, 'rgba(21, 21, 18, 0)');
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    return makeTexture(canvas, 1, 1, true);
  });
}
