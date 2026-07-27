import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { clockwiseTravelToStop } from './dialPhysics';

export type PhoneMaterials = {
  greenBakelite: THREE.MeshPhysicalMaterial;
  blackBakelite: THREE.MeshPhysicalMaterial;
  blackMatte: THREE.MeshStandardMaterial;
  nickel: THREE.MeshPhysicalMaterial;
  dialMetal: THREE.MeshPhysicalMaterial;
  ivory: THREE.MeshStandardMaterial;
  darkCavity: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
};

export type PhoneModel = {
  root: THREE.Group;
  receiver: THREE.Group;
  receiverHitTarget: THREE.Mesh;
  receiverHomePosition: THREE.Vector3;
  receiverHomeQuaternion: THREE.Quaternion;
  dialPivot: THREE.Group;
  dialHitTargets: THREE.Mesh[];
  dialTouchTarget: THREE.Mesh;
  dialTravelByDigit: ReadonlyMap<number, number>;
  hookSwitches: [THREE.Group, THREE.Group];
  bodyCordSocket: THREE.Object3D;
  receiverCordSocket: THREE.Object3D;
  cord: THREE.Mesh;
  updateCord: () => void;
  dispose: () => void;
};

type TextureSet = {
  albedo: THREE.DataTexture;
  roughness: THREE.DataTexture;
  normal: THREE.DataTexture;
  ao: THREE.DataTexture;
};

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeTextureSet(
  seed: number,
  base: THREE.Color,
  options: {
    variation: number;
    roughness: number;
    normalStrength: number;
    radial?: boolean;
    fibers?: boolean;
  },
): TextureSet {
  const size = 1024;
  const count = size * size;
  const albedoData = new Uint8Array(count * 4);
  const roughData = new Uint8Array(count * 4);
  const height = new Float32Array(count);
  const normalData = new Uint8Array(count * 4);
  const aoData = new Uint8Array(count * 4);
  const random = seeded(seed);
  const noise = new Float32Array(count);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const low = Math.sin(x * 0.037 + seed) * 0.32 + Math.cos(y * 0.043 - seed) * 0.28;
      const meso = Math.sin((x + y) * 0.19) * 0.14;
      const micro = (random() - 0.5) * 0.38;
      const radial = options.radial
        ? Math.sin(Math.atan2(y - size / 2, x - size / 2) * 96 + Math.hypot(x - size / 2, y - size / 2) * 0.42) * 0.12
        : 0;
      const fibers = options.fibers
        ? Math.sin(y * 0.72 + Math.sin(x * 0.034) * 2.4) * 0.055
          + Math.sin(x * 0.19 + y * 0.075) * 0.025
        : 0;
      noise[index] = THREE.MathUtils.clamp(0.5 + low + meso + micro + radial + fibers, 0, 1);
      height[index] = THREE.MathUtils.clamp(
        0.5 + micro * 0.7 + meso * 0.22 + radial + fibers * 0.62,
        0,
        1,
      );
    }
  }

  const rgb: [number, number, number] = [base.r * 255, base.g * 255, base.b * 255];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const offset = index * 4;
      const noiseValue = noise[index] ?? 0.5;
      const n = (noiseValue - 0.5) * options.variation;
      albedoData[offset] = THREE.MathUtils.clamp(rgb[0] * (1 + n), 0, 255);
      albedoData[offset + 1] = THREE.MathUtils.clamp(rgb[1] * (1 + n * 0.82), 0, 255);
      albedoData[offset + 2] = THREE.MathUtils.clamp(rgb[2] * (1 + n * 0.68), 0, 255);
      albedoData[offset + 3] = 255;

      const roughness = THREE.MathUtils.clamp(options.roughness + (noiseValue - 0.5) * 0.18, 0.08, 0.98);
      const roughByte = roughness * 255;
      roughData.set([roughByte, roughByte, roughByte, 255], offset);

      const ao = THREE.MathUtils.clamp(0.9 + (noiseValue - 0.5) * 0.08, 0.76, 1);
      const aoByte = ao * 255;
      aoData.set([aoByte, aoByte, aoByte, 255], offset);
    }
  }

  const sampleHeight = (x: number, y: number) => {
    const px = (x + size) % size;
    const py = (y + size) % size;
    return height[py * size + px] ?? 0.5;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const dx = (sampleHeight(x + 1, y) - sampleHeight(x - 1, y)) * options.normalStrength;
      const dy = (sampleHeight(x, y + 1) - sampleHeight(x, y - 1)) * options.normalStrength;
      const normal = new THREE.Vector3(-dx, -dy, 1).normalize();
      normalData[offset] = (normal.x * 0.5 + 0.5) * 255;
      normalData[offset + 1] = (normal.y * 0.5 + 0.5) * 255;
      normalData[offset + 2] = normal.z * 255;
      normalData[offset + 3] = 255;
    }
  }

  const make = (data: Uint8Array, colorSpace: THREE.ColorSpace) => {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    texture.colorSpace = colorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  };

  return {
    albedo: make(albedoData, THREE.SRGBColorSpace),
    roughness: make(roughData, THREE.NoColorSpace),
    normal: make(normalData, THREE.NoColorSpace),
    ao: make(aoData, THREE.NoColorSpace),
  };
}

function prepareGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = geometry.getAttribute('uv');
  if (uv && !geometry.getAttribute('uv1')) {
    geometry.setAttribute('uv1', uv.clone());
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createMaterials(): { materials: PhoneMaterials; textures: THREE.Texture[] } {
  const greenMaps = makeTextureSet(1934, new THREE.Color('#185347'), {
    variation: 0.045,
    roughness: 0.39,
    normalStrength: 2.7,
  });
  const blackMaps = makeTextureSet(1935, new THREE.Color('#10110f'), {
    variation: 0.04,
    roughness: 0.43,
    normalStrength: 2.2,
  });
  const nickelMaps = makeTextureSet(1936, new THREE.Color('#bdb5a5'), {
    variation: 0.16,
    roughness: 0.36,
    normalStrength: 3.2,
    radial: true,
  });
  const ivoryMaps = makeTextureSet(1937, new THREE.Color('#bca77f'), {
    variation: 0.11,
    roughness: 0.95,
    normalStrength: 1.08,
    fibers: true,
  });

  const greenBakelite = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    map: greenMaps.albedo,
    roughness: 0.84,
    roughnessMap: greenMaps.roughness,
    metalness: 0.015,
    normalMap: greenMaps.normal,
    normalScale: new THREE.Vector2(0.018, 0.018),
    aoMap: greenMaps.ao,
    aoMapIntensity: 0.5,
    clearcoat: 0.4,
    clearcoatRoughness: 0.32,
    envMapIntensity: 0.94,
  });
  const blackBakelite = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    map: blackMaps.albedo,
    roughness: 0.79,
    roughnessMap: blackMaps.roughness,
    metalness: 0.01,
    normalMap: blackMaps.normal,
    normalScale: new THREE.Vector2(0.016, 0.016),
    aoMap: blackMaps.ao,
    aoMapIntensity: 0.45,
    clearcoat: 0.33,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.88,
  });
  const blackMatte = new THREE.MeshStandardMaterial({
    color: '#080908',
    roughness: 0.78,
    metalness: 0,
  });
  const nickel = new THREE.MeshPhysicalMaterial({
    color: '#d0c7b6',
    roughness: 0.84,
    roughnessMap: nickelMaps.roughness,
    metalness: 0.94,
    normalMap: nickelMaps.normal,
    normalScale: new THREE.Vector2(0.035, 0.035),
    anisotropy: 0.82,
    anisotropyRotation: Math.PI / 2,
    envMapIntensity: 1.22,
  });
  const dialMetal = new THREE.MeshPhysicalMaterial({
    color: '#70695b',
    roughness: 0.92,
    metalness: 0.46,
    clearcoat: 0.02,
    clearcoatRoughness: 0.9,
    specularIntensity: 0.3,
    envMapIntensity: 0.2,
  });
  const ivory = new THREE.MeshStandardMaterial({
    color: '#bea982',
    map: ivoryMaps.albedo,
    roughness: 0.98,
    roughnessMap: ivoryMaps.roughness,
    normalMap: ivoryMaps.normal,
    normalScale: new THREE.Vector2(0.018, 0.018),
    aoMap: ivoryMaps.ao,
    aoMapIntensity: 0.72,
    metalness: 0,
    envMapIntensity: 0.2,
  });
  const darkCavity = new THREE.MeshStandardMaterial({
    color: '#030403',
    roughness: 0.96,
    metalness: 0,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: '#0c0d0b',
    roughness: 0.74,
    metalness: 0,
  });

  return {
    materials: {
      greenBakelite,
      blackBakelite,
      blackMatte,
      nickel,
      dialMetal,
      ivory,
      darkCavity,
      rubber,
    },
    textures: [
      ...Object.values(greenMaps),
      ...Object.values(blackMaps),
      ...Object.values(nickelMaps),
      ...Object.values(ivoryMaps),
    ],
  };
}

function makeMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  options: { cast?: boolean; receive?: boolean; name?: string } = {},
) {
  const mesh = new THREE.Mesh(prepareGeometry(geometry), material);
  mesh.castShadow = options.cast ?? true;
  mesh.receiveShadow = options.receive ?? true;
  if (options.name) mesh.name = options.name;
  return mesh;
}

const AMERICAN_DIAL_LETTERS: Record<number, string> = {
  0: 'OPER',
  2: 'ABC',
  3: 'DEF',
  4: 'GHI',
  5: 'JKL',
  6: 'MNO',
  7: 'PRS',
  8: 'TUV',
  9: 'WXY',
};

function createDigitTexture(value: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 192;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required for dial labels.');

  // Flat cream card albedo (kept mostly even so scene lighting — not a baked
  // highlight — defines the shading once the label material is lit).
  const gradient = context.createRadialGradient(96, 92, 20, 96, 96, 96);
  gradient.addColorStop(0, '#e3d6bb');
  gradient.addColorStop(0.72, '#d8c8a8');
  gradient.addColorStop(1, '#bca77f');
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(96, 96, 90, 0, Math.PI * 2);
  context.fill();
  // Faint recessed rim so the printed card reads as inset under the cover.
  context.strokeStyle = 'rgba(58, 43, 28, .3)';
  context.lineWidth = 2.5;
  context.beginPath();
  context.arc(96, 96, 86, 0, Math.PI * 2);
  context.stroke();

  let wearSeed = (193400 + value * 7919) >>> 0;
  const wearRandom = () => {
    wearSeed = (Math.imul(wearSeed, 1664525) + 1013904223) >>> 0;
    return wearSeed / 4294967296;
  };
  for (let mark = 0; mark < 90; mark += 1) {
    const angle = wearRandom() * Math.PI * 2;
    const radius = 22 + Math.pow(wearRandom(), 0.42) * 61;
    const x = 96 + Math.cos(angle) * radius;
    const y = 96 + Math.sin(angle) * radius;
    context.beginPath();
    context.ellipse(x, y, 0.5 + wearRandom() * 1.6, 0.25 + wearRandom() * 0.7, angle, 0, Math.PI * 2);
    context.fillStyle = `rgba(84, 62, 38, ${0.018 + wearRandom() * 0.04})`;
    context.fill();
  }
  context.strokeStyle = 'rgba(83, 61, 38, 0.13)';
  context.lineWidth = 5;
  context.beginPath();
  context.arc(96, 96, 80, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = '#171009';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const letters = AMERICAN_DIAL_LETTERS[value] ?? '';
  context.font = `700 ${letters ? 82 : 104}px "Franklin Gothic Medium", "Arial Narrow", Arial, sans-serif`;
  context.fillText(String(value), 96, letters ? 78 : 102);
  if (letters) {
    context.fillStyle = '#5b452f';
    context.font = `700 ${value === 0 ? 22 : 32}px "Arial Narrow", Arial, sans-serif`;
    context.letterSpacing = value === 0 ? '2px' : '5px';
    context.fillText(letters, 96, 139);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function deformBodyShell(geometry: RoundedBoxGeometry) {
  const positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const upper = THREE.MathUtils.smoothstep(y, -0.1, 0.8);
    const frontBias = THREE.MathUtils.smoothstep(z, -0.2, 1.45);
    const xScale = THREE.MathUtils.lerp(1, 0.79, upper);
    const zScale = THREE.MathUtils.lerp(1, 0.86, upper);
    const shoulderLift = upper * (1 - Math.min(1, Math.abs(x) / 2.3)) * 0.12;
    positions.setXYZ(index, x * xScale, y + shoulderLift + frontBias * upper * 0.04, z * zScale);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
}

function createReceiver(materials: PhoneMaterials): {
  receiver: THREE.Group;
  hitTarget: THREE.Mesh;
  cordSocket: THREE.Object3D;
} {
  const receiver = new THREE.Group();
  receiver.name = 'receiver';

  const gripCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.65, -0.04, 0),
    new THREE.Vector3(-0.88, 0.12, 0),
    new THREE.Vector3(0, 0.18, 0),
    new THREE.Vector3(0.88, 0.12, 0),
    new THREE.Vector3(1.65, -0.04, 0),
  ]);
  const grip = makeMesh(new THREE.TubeGeometry(gripCurve, 80, 0.22, 20, false), materials.blackBakelite, {
    name: 'receiver-grip',
  });
  grip.scale.z = 1.2;
  receiver.add(grip);

  for (const side of [-1, 1] as const) {
    const x = side * 1.84;
    const neck = makeMesh(
      new THREE.CylinderGeometry(0.28, 0.34, 0.62, 28, 2),
      materials.blackBakelite,
    );
    neck.rotation.z = Math.PI / 2;
    neck.position.set(side * 1.57, -0.06, 0);
    receiver.add(neck);

    const cap = makeMesh(new THREE.SphereGeometry(0.55, 40, 28), materials.blackBakelite, {
      name: side < 0 ? 'receiver-cap-left' : 'receiver-cap-right',
    });
    cap.scale.set(1.03, 0.86, 1.08);
    cap.position.set(x, -0.18, 0);
    receiver.add(cap);

    const lowerCap = makeMesh(
      new THREE.CylinderGeometry(0.42, 0.36, 0.24, 36, 2),
      materials.blackBakelite,
    );
    lowerCap.position.set(x, -0.49, 0);
    receiver.add(lowerCap);

    const face = makeMesh(
      new THREE.CylinderGeometry(0.34, 0.34, 0.045, 40),
      materials.blackMatte,
    );
    face.position.set(x, -0.63, 0);
    receiver.add(face);

    const seam = makeMesh(
      new THREE.TorusGeometry(0.43, 0.015, 8, 48),
      materials.darkCavity,
      { cast: false },
    );
    seam.rotation.x = Math.PI / 2;
    seam.scale.x = 1.06;
    seam.position.set(x, -0.39, 0);
    receiver.add(seam);

    for (let holeIndex = 0; holeIndex < 9; holeIndex += 1) {
      const ring = holeIndex === 0 ? 0 : 0.15;
      const angle = ((holeIndex - 1) / 8) * Math.PI * 2;
      const hole = makeMesh(new THREE.SphereGeometry(0.025, 10, 8), materials.darkCavity, {
        cast: false,
      });
      hole.scale.y = 0.3;
      hole.position.set(x + Math.cos(angle) * ring, -0.659, Math.sin(angle) * ring);
      receiver.add(hole);
    }
  }

  const cordSocket = new THREE.Object3D();
  cordSocket.name = 'receiver-cord-socket';
  cordSocket.position.set(-2.22, -0.28, -0.08);
  receiver.add(cordSocket);

  const hitTarget = new THREE.Mesh(
    new RoundedBoxGeometry(4.7, 0.94, 1.05, 3, 0.3),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    }),
  );
  hitTarget.position.y = -0.16;
  hitTarget.userData.kind = 'receiver';
  receiver.add(hitTarget);

  return { receiver, hitTarget, cordSocket };
}

function createCradle(
  root: THREE.Group,
  materials: PhoneMaterials,
): [THREE.Group, THREE.Group] {
  const hooks: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const x = side * 1.43;
    const horn = makeMesh(
      new RoundedBoxGeometry(0.54, 0.88, 0.68, 5, 0.16),
      materials.greenBakelite,
    );
    horn.position.set(x, 1.78, -0.26);
    horn.rotation.z = side * -0.07;
    root.add(horn);

    const cup = makeMesh(
      new THREE.TorusGeometry(0.26, 0.075, 12, 40, Math.PI),
      materials.blackMatte,
      { cast: false },
    );
    cup.position.set(x, 2.2, -0.15);
    cup.rotation.z = Math.PI;
    cup.scale.x = 1.12;
    root.add(cup);
  }

  for (const x of [-0.46, 0.46]) {
    const hook = new THREE.Group();
    const stem = makeMesh(
      new THREE.CylinderGeometry(0.055, 0.075, 0.28, 20),
      materials.nickel,
    );
    const crown = makeMesh(
      new THREE.CylinderGeometry(0.13, 0.09, 0.07, 24),
      materials.nickel,
    );
    crown.position.y = 0.17;
    hook.add(stem, crown);
    hook.position.set(x, 2.02, -0.1);
    root.add(hook);
    hooks.push(hook);
  }
  return hooks as [THREE.Group, THREE.Group];
}

function createDial(materials: PhoneMaterials): {
  assembly: THREE.Group;
  pivot: THREE.Group;
  hitTargets: THREE.Mesh[];
  touchTarget: THREE.Mesh;
  digitTextures: THREE.Texture[];
  travelByDigit: ReadonlyMap<number, number>;
} {
  const assembly = new THREE.Group();
  assembly.name = 'dial-assembly';
  assembly.position.set(0.2, 1.47, 1.56);
  assembly.rotation.x = -0.24;

  const back = makeMesh(
    new THREE.CylinderGeometry(1.38, 1.42, 0.18, 96),
    materials.blackMatte,
  );
  back.rotation.x = Math.PI / 2;
  assembly.add(back);

  const ivoryBed = makeMesh(
    new THREE.CylinderGeometry(1.23, 1.23, 0.08, 96),
    materials.ivory,
  );
  ivoryBed.rotation.x = Math.PI / 2;
  ivoryBed.position.z = 0.1;
  assembly.add(ivoryBed);

  const pivot = new THREE.Group();
  pivot.name = 'dial-pivot';
  pivot.position.z = 0.16;
  assembly.add(pivot);

  const wheelPlate = makeMesh(
    new THREE.RingGeometry(0.48, 1.2, 96, 4),
    materials.dialMetal,
  );
  wheelPlate.position.z = 0.015;
  pivot.add(wheelPlate);

  const outerRim = makeMesh(
    new THREE.TorusGeometry(1.22, 0.055, 16, 96),
    materials.dialMetal,
  );
  outerRim.position.z = 0.06;
  pivot.add(outerRim);

  const innerRim = makeMesh(
    new THREE.TorusGeometry(0.48, 0.032, 12, 64),
    materials.dialMetal,
  );
  innerRim.position.z = 0.065;
  pivot.add(innerRim);

  const touchTarget = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 1.18, 64),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    }),
  );
  touchTarget.position.z = 0.18;
  touchTarget.userData.kind = 'dial-surface';
  pivot.add(touchTarget);

  const hitTargets: THREE.Mesh[] = [];
  const digitTextures: THREE.Texture[] = [];
  const travelByDigit = new Map<number, number>();
  const digitRadius = 0.9;
  const fingerStopPosition = new THREE.Vector2(0.92, -0.75);
  const fingerStopRotation = -0.74;
  const fingerStopOuterTip = new THREE.Vector2(0, 0.31)
    .rotateAround(new THREE.Vector2(), fingerStopRotation)
    .add(fingerStopPosition);
  const fingerStopAngle = Math.atan2(fingerStopOuterTip.y, fingerStopOuterTip.x);
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
  digits.forEach((digit, index) => {
    const angle = THREE.MathUtils.degToRad(45 + index * 30);
    travelByDigit.set(digit, clockwiseTravelToStop(angle, fingerStopAngle));
    const x = Math.cos(angle) * digitRadius;
    const y = Math.sin(angle) * digitRadius;
    const digitTexture = createDigitTexture(digit);
    digitTextures.push(digitTexture);

    const label = makeMesh(
      new THREE.CircleGeometry(0.185, 32),
      new THREE.MeshStandardMaterial({
        map: digitTexture,
        color: '#c0aa82',
        roughness: 0.98,
        metalness: 0,
        envMapIntensity: 0.1,
      }),
      { cast: false },
    );
    label.position.set(x, y, 0.075);
    pivot.add(label);

    const ring = makeMesh(
      new THREE.TorusGeometry(0.205, 0.038, 14, 42),
      materials.dialMetal,
    );
    ring.position.set(x, y, 0.105);
    pivot.add(ring);

    const target = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.18, 24),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      }),
    );
    target.rotation.x = Math.PI / 2;
    target.position.set(x, y, 0.12);
    target.userData.kind = 'digit';
    target.userData.digit = digit;
    pivot.add(target);
    hitTargets.push(target);
  });

  const cap = makeMesh(
    new THREE.CylinderGeometry(0.47, 0.47, 0.14, 64),
    materials.dialMetal,
  );
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 0.12;
  pivot.add(cap);

  const hub = makeMesh(
    new THREE.CylinderGeometry(0.105, 0.13, 0.12, 32),
    materials.nickel,
  );
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.23;
  pivot.add(hub);

  const stop = makeMesh(
    new RoundedBoxGeometry(0.18, 0.62, 0.17, 4, 0.06),
    materials.nickel,
  );
  stop.position.set(fingerStopPosition.x, fingerStopPosition.y, 0.19);
  stop.rotation.z = fingerStopRotation;
  assembly.add(stop);

  return { assembly, pivot, hitTargets, touchTarget, digitTextures, travelByDigit };
}

function createCordGeometry(start: THREE.Vector3, end: THREE.Vector3, lifted: boolean) {
  const spread = THREE.MathUtils.clamp(start.distanceTo(end), 1.5, 5);
  const controlPoints = lifted
    ? end.x > 0
      ? [
          start,
          start.clone().add(new THREE.Vector3(-0.48, -0.48, 0.82)),
          new THREE.Vector3(-1.35, 0.12, 2.55),
          new THREE.Vector3(2.75, 0.25, 2.05),
          new THREE.Vector3(3.15, 1.82, 0.28),
          end.clone().add(new THREE.Vector3(0.62, -0.36, -0.24)),
          end,
        ]
      : [
          start,
          start.clone().add(new THREE.Vector3(-0.48, -0.36, 0.42)),
          new THREE.Vector3(-2.82, 0.18, 0.9),
          end.clone().add(new THREE.Vector3(-0.26, -0.42, 0.12)),
          end,
        ]
    : [
        start,
        start.clone().add(new THREE.Vector3(-0.7, -0.42, 0.22)),
        new THREE.Vector3(-2.85, 0.18, 0.72),
        new THREE.Vector3(-2.28, 0.2, 1.25),
        end,
      ];
  const baseCurve = new THREE.CatmullRomCurve3(controlPoints, false, 'centripetal');
  const coilPoints: THREE.Vector3[] = [];
  const turns = Math.round(44 + spread * 3);
  const samples = 170;
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const point = baseCurve.getPointAt(t);
    baseCurve.getTangentAt(t, tangent).normalize();
    normal.crossVectors(tangent, up);
    if (normal.lengthSq() < 0.01) normal.set(1, 0, 0);
    normal.normalize();
    binormal.crossVectors(tangent, normal).normalize();
    const envelope = Math.sin(Math.PI * THREE.MathUtils.smoothstep(t, 0, 1));
    const radius = 0.085 * envelope;
    const angle = t * Math.PI * 2 * turns;
    point
      .addScaledVector(normal, Math.cos(angle) * radius)
      .addScaledVector(binormal, Math.sin(angle) * radius);
    coilPoints.push(point);
  }
  const coilCurve = new THREE.CatmullRomCurve3(coilPoints, false, 'centripetal');
  return new THREE.TubeGeometry(coilCurve, samples * 2, 0.032, 8, false);
}

export function createPhoneModel(): PhoneModel {
  const root = new THREE.Group();
  root.name = 'phone-root';
  const { materials, textures } = createMaterials();
  const geometries: THREE.BufferGeometry[] = [];
  const extraMaterials: THREE.Material[] = [];

  const track = <T extends THREE.BufferGeometry>(geometry: T) => {
    geometries.push(geometry);
    return geometry;
  };

  const plinth = makeMesh(
    track(new RoundedBoxGeometry(5.05, 0.48, 3.06, 7, 0.22)),
    materials.greenBakelite,
  );
  plinth.position.y = 0.35;
  root.add(plinth);

  const shellGeometry = track(new RoundedBoxGeometry(4.7, 1.55, 2.72, 10, 0.38));
  deformBodyShell(shellGeometry);
  const shell = makeMesh(shellGeometry, materials.greenBakelite, { name: 'body-shell' });
  shell.position.set(0, 1.02, -0.03);
  root.add(shell);

  for (const side of [-1, 1] as const) {
    const pod = makeMesh(track(new THREE.SphereGeometry(0.82, 48, 32)), materials.greenBakelite);
    pod.scale.set(1.18, 0.8, 1.08);
    pod.position.set(side * 1.68, 0.83, 0.78);
    root.add(pod);

    const shoulder = makeMesh(track(new THREE.SphereGeometry(0.68, 40, 28)), materials.greenBakelite);
    shoulder.scale.set(1, 1.25, 0.88);
    shoulder.position.set(side * 1.4, 1.47, -0.18);
    root.add(shoulder);
  }

  const dialPedestal = makeMesh(
    track(new RoundedBoxGeometry(2.82, 1.55, 0.58, 8, 0.22)),
    materials.greenBakelite,
  );
  dialPedestal.position.set(0.2, 1.24, 1.26);
  dialPedestal.rotation.x = -0.24;
  root.add(dialPedestal);

  const seam = makeMesh(
    track(new THREE.TorusGeometry(2.12, 0.02, 8, 80, Math.PI)),
    materials.darkCavity,
    { cast: false },
  );
  seam.position.set(0, 0.49, 0.68);
  seam.scale.set(1.05, 0.72, 1);
  seam.rotation.z = Math.PI;
  root.add(seam);

  const hookSwitches = createCradle(root, materials);
  const dial = createDial(materials);
  root.add(dial.assembly);

  const receiverData = createReceiver(materials);
  const receiver = receiverData.receiver;
  receiver.position.set(0, 2.57, -0.14);
  root.add(receiver);
  const receiverHomePosition = receiver.position.clone();
  const receiverHomeQuaternion = receiver.quaternion.clone();

  for (const x of [-1.9, 1.9]) {
    for (const z of [-1.05, 0.98]) {
      const foot = makeMesh(
        track(new THREE.CylinderGeometry(0.16, 0.19, 0.12, 24)),
        materials.rubber,
      );
      foot.position.set(x, 0.08, z);
      root.add(foot);
    }
  }

  const bodyCordSocket = new THREE.Object3D();
  bodyCordSocket.name = 'body-cord-socket';
  bodyCordSocket.position.set(-2.18, 0.78, -0.42);
  root.add(bodyCordSocket);

  root.updateMatrixWorld(true);
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  bodyCordSocket.getWorldPosition(start);
  receiverData.cordSocket.getWorldPosition(end);
  root.worldToLocal(start);
  root.worldToLocal(end);
  const cordGeometry = track(createCordGeometry(start, end, false));
  const cord = makeMesh(cordGeometry, materials.rubber, { name: 'coiled-cord' });
  root.add(cord);

  const updateCord = () => {
    root.updateMatrixWorld(true);
    bodyCordSocket.getWorldPosition(start);
    receiverData.cordSocket.getWorldPosition(end);
    root.worldToLocal(start);
    root.worldToLocal(end);
    const lifted = receiver.position.distanceTo(receiverHomePosition) > 0.28;
    const next = prepareGeometry(createCordGeometry(start, end, lifted));
    cord.geometry.dispose();
    cord.geometry = next;
  };

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const isInteractionTarget = object.userData.kind === 'receiver' || object.userData.kind === 'digit';
      object.castShadow = !isInteractionTarget;
      object.receiveShadow = !isInteractionTarget;
      if (object.geometry && !geometries.includes(object.geometry)) geometries.push(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      objectMaterials.forEach((material) => {
        if (!Object.values(materials).includes(material as never) && !extraMaterials.includes(material)) {
          extraMaterials.push(material);
        }
      });
    }
  });

  root.userData.sculptRuntime = {
    nodes: {
      'phone-root': root,
      receiver,
      'dial-pivot': dial.pivot,
      'hook-left': hookSwitches[0],
      'hook-right': hookSwitches[1],
      'coiled-cord': cord,
    },
    sockets: {
      'body-cord-socket': bodyCordSocket,
      'receiver-cord-socket': receiverData.cordSocket,
    },
    colliders: {
      receiver: receiverData.hitTarget,
      dial: dial.hitTargets,
    },
  };

  return {
    root,
    receiver,
    receiverHitTarget: receiverData.hitTarget,
    receiverHomePosition,
    receiverHomeQuaternion,
    dialPivot: dial.pivot,
    dialHitTargets: dial.hitTargets,
    dialTouchTarget: dial.touchTarget,
    dialTravelByDigit: dial.travelByDigit,
    hookSwitches,
    bodyCordSocket,
    receiverCordSocket: receiverData.cordSocket,
    cord,
    updateCord,
    dispose: () => {
      const seenGeometry = new Set<THREE.BufferGeometry>();
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (!seenGeometry.has(object.geometry)) {
          object.geometry.dispose();
          seenGeometry.add(object.geometry);
        }
        const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
        meshMaterials.forEach((material) => {
          if (!Object.values(materials).includes(material as never)) material.dispose();
        });
      });
      Object.values(materials).forEach((material) => material.dispose());
      extraMaterials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      dial.digitTextures.forEach((texture) => texture.dispose());
    },
  };
}
