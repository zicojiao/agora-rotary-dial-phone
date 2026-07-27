import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { createPhoneModel } from './createPhone';
import { PhoneAudio } from './PhoneAudio';
import { PhoneController, type PhoneSnapshot } from './PhoneController';
import { advanceDialGesture, beginDialGesture, type DialGesture } from './dialPhysics';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const loading = document.querySelector<HTMLElement>('#loading');
const errorPanel = document.querySelector<HTMLElement>('#error-panel');
const statusLabel = document.querySelector<HTMLElement>('#status-label');
const numberDisplay = document.querySelector<HTMLOutputElement>('#number-display');
const readoutLabel = document.querySelector<HTMLElement>('.readout-label');
const mobileGuideStep = document.querySelector<HTMLElement>('#mobile-guide-step');
const mobileGuideText = document.querySelector<HTMLElement>('#mobile-guide-text');
const pulseProgress = document.querySelector<HTMLElement>('#pulse-progress');
const receiverButton = document.querySelector<HTMLButtonElement>('#receiver-button');
const receiverAction = document.querySelector<HTMLElement>('#receiver-action');
const clearButton = document.querySelector<HTMLButtonElement>('#clear-button');

if (
  !canvas ||
  !loading ||
  !errorPanel ||
  !statusLabel ||
  !numberDisplay ||
  !readoutLabel ||
  !mobileGuideStep ||
  !mobileGuideText ||
  !pulseProgress ||
  !receiverButton ||
  !receiverAction ||
  !clearButton
) {
  throw new Error('Required interface controls are missing.');
}

function createWalnutTexture(renderer: THREE.WebGLRenderer) {
  const width = 1024;
  const height = 512;
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = width;
  textureCanvas.height = height;
  const context = textureCanvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required for the table texture.');

  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#4a2f1f');
  gradient.addColorStop(0.55, '#291a12');
  gradient.addColorStop(1, '#160e0a');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const random = (() => {
    let state = 4041934;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  })();
  for (let line = 0; line < 150; line += 1) {
    const y = random() * height;
    context.beginPath();
    context.moveTo(0, y);
    for (let x = 0; x <= width; x += 16) {
      const wave = Math.sin(x * 0.014 + line * 1.7) * (3 + random() * 5);
      context.lineTo(x, y + wave + (random() - 0.5) * 1.8);
    }
    context.strokeStyle = `rgba(${98 + Math.floor(random() * 40)}, ${51 + Math.floor(random() * 24)}, 27, ${0.035 + random() * 0.1})`;
    context.lineWidth = 0.45 + random() * 2.2;
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.2, 1.1);
  texture.anisotropy = Math.min(12, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function createPlasterTexture() {
  const size = 512;
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = textureCanvas.height = size;
  const context = textureCanvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required for the wall texture.');
  const image = context.createImageData(size, size);
  let state = 1934;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const grain = ((state / 4294967296) - 0.5) * 22;
    image.data[offset] = 106 + grain;
    image.data[offset + 1] = 104 + grain;
    image.data[offset + 2] = 95 + grain;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);
  return texture;
}

function createContactNote(renderer: THREE.WebGLRenderer) {
  const width = 1024;
  const height = 512;
  const noteCanvas = document.createElement('canvas');
  noteCanvas.width = width;
  noteCanvas.height = height;
  const context = noteCanvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required for the contact note.');

  const paper = context.createLinearGradient(0, 0, width, height);
  paper.addColorStop(0, '#dfd2b5');
  paper.addColorStop(0.52, '#d5c5a4');
  paper.addColorStop(1, '#c7b591');
  context.fillStyle = paper;
  context.fillRect(0, 0, width, height);

  let state = 19121934;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let index = 0; index < 720; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const length = 5 + random() * 24;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length, y + (random() - 0.5) * 2);
    context.strokeStyle = `rgba(81, 64, 42, ${0.018 + random() * 0.03})`;
    context.lineWidth = 0.45 + random() * 0.65;
    context.stroke();
  }

  context.strokeStyle = 'rgba(76, 57, 34, 0.22)';
  context.lineWidth = 2;
  context.strokeRect(34, 30, width - 68, height - 60);
  context.fillStyle = '#8b6237';
  context.font = '700 25px "Arial Narrow", "Franklin Gothic Medium", Arial, sans-serif';
  context.letterSpacing = '7px';
  context.fillText('AGORA CONVERSATIONAL AI LINE', 76, 82);
  context.fillRect(76, 118, width - 152, 2);

  context.fillStyle = '#33271d';
  context.font = '700 58px "Arial Narrow", "Franklin Gothic Medium", Arial, sans-serif';
  context.letterSpacing = '4px';
  context.fillText('ELON MUSK', 76, 198);
  context.font = '700 66px "Arial Narrow", "Franklin Gothic Medium", Arial, sans-serif';
  context.letterSpacing = '3px';
  context.fillText('KLONDIKE 5-0193', 76, 292);

  context.fillStyle = '#3b2c20';
  context.fillRect(72, 330, width - 144, 90);
  context.strokeStyle = 'rgba(64, 46, 28, 0.55)';
  context.lineWidth = 3;
  context.strokeRect(72, 330, width - 144, 90);
  context.fillStyle = '#f1e4c6';
  context.font = '700 58px "Arial Narrow", "Franklin Gothic Medium", Arial, sans-serif';
  context.letterSpacing = '4px';
  context.fillText('DIAL 555-0193', 104, 391);
  context.fillStyle = '#d6bb8e';
  context.font = '700 23px "Arial Narrow", Arial, sans-serif';
  context.letterSpacing = '3px';
  context.fillText('KL = 55 ON THE DIAL', 686, 386);

  context.fillStyle = 'rgba(72, 52, 33, 0.58)';
  context.font = '600 21px "Arial Narrow", Arial, sans-serif';
  context.letterSpacing = '6px';
  context.fillText('AI VOICE LINE · NEW YORK', 78, 468);

  const texture = new THREE.CanvasTexture(noteCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(12, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;

  const noteWidth = 2.85;
  const noteHeight = 1.425;
  const geometry = new THREE.PlaneGeometry(noteWidth, noteHeight, 12, 6);
  const positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const curledEdge = Math.pow(Math.abs(x) / (noteWidth / 2), 6) * 0.025;
    const softenedCorner = Math.pow(Math.abs(y) / (noteHeight / 2), 8) * 0.01;
    const paperRipple = Math.sin(x * 3.1 + y * 2.2) * 0.0025;
    positions.setZ(index, curledEdge + softenedCorner + paperRipple);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: '#d8c6a3',
    map: texture,
    roughness: 0.97,
    metalness: 0,
    envMapIntensity: 0.14,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const root = new THREE.Group();
  root.name = 'contact-note';
  root.position.set(4.48, 0.035, -1.56);
  root.rotation.y = -0.16;
  root.add(mesh);

  return {
    mesh: root,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

function createSetDecor() {
  const root = new THREE.Group();
  root.name = 'art-deco-set-dressing';

  const brass = new THREE.MeshStandardMaterial({
    color: '#80613d',
    roughness: 0.64,
    metalness: 0.62,
    envMapIntensity: 0.24,
  });
  const blackLacquer = new THREE.MeshStandardMaterial({
    color: '#161817',
    roughness: 0.48,
    metalness: 0.14,
    envMapIntensity: 0.24,
  });
  const smokedGlass = new THREE.MeshPhysicalMaterial({
    color: '#263936',
    roughness: 0.3,
    transmission: 0.08,
    thickness: 0.35,
    envMapIntensity: 0.22,
  });

  const clockIvory = new THREE.MeshStandardMaterial({
    color: '#bbae8d',
    roughness: 0.88,
    metalness: 0,
    envMapIntensity: 0.12,
  });
  const clock = new THREE.Group();
  clock.name = 'art-deco-wall-clock';
  clock.position.set(3.45, 3.3, -4.44);

  const clockCase = new THREE.Mesh(
    new THREE.CylinderGeometry(1.02, 1.02, 0.14, 8),
    blackLacquer,
  );
  clockCase.rotation.x = Math.PI / 2;
  clockCase.castShadow = true;
  clock.add(clockCase);

  const clockBezel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.83, 0.83, 0.09, 48),
    brass,
  );
  clockBezel.rotation.x = Math.PI / 2;
  clockBezel.position.z = 0.09;
  clock.add(clockBezel);

  const clockFace = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.72, 0.045, 48),
    clockIvory,
  );
  clockFace.rotation.x = Math.PI / 2;
  clockFace.position.z = 0.15;
  clock.add(clockFace);

  for (let hour = 0; hour < 12; hour += 1) {
    const angle = (hour / 12) * Math.PI * 2;
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(hour % 3 === 0 ? 0.045 : 0.028, hour % 3 === 0 ? 0.16 : 0.1, 0.025),
      brass,
    );
    marker.position.set(Math.sin(angle) * 0.58, Math.cos(angle) * 0.58, 0.19);
    marker.rotation.z = -angle;
    clock.add(marker);
  }

  const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.42, 0.035), blackLacquer);
  hourHand.position.set(0.12, 0.16, 0.205);
  hourHand.rotation.z = -0.64;
  clock.add(hourHand);

  const minuteHand = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.57, 0.035), blackLacquer);
  minuteHand.position.set(-0.23, 0.15, 0.21);
  minuteHand.rotation.z = 0.98;
  clock.add(minuteHand);

  const clockPin = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.045, 18), brass);
  clockPin.rotation.x = Math.PI / 2;
  clockPin.position.z = 0.23;
  clock.add(clockPin);

  const clockCrown = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.12), brass);
  clockCrown.position.set(0, 1.02, 0.02);
  clock.add(clockCrown);
  root.add(clock);

  const pen = new THREE.Group();
  pen.name = 'fountain-pen';
  pen.position.set(-3.75, 0.105, -1.38);
  pen.rotation.y = -0.16;

  const penBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.061, 1.72, 18),
    blackLacquer,
  );
  penBody.rotation.z = Math.PI / 2;
  penBody.castShadow = true;
  pen.add(penBody);

  const penCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.064, 0.064, 0.48, 18),
    blackLacquer,
  );
  penCap.rotation.z = Math.PI / 2;
  penCap.position.x = -0.92;
  penCap.castShadow = true;
  pen.add(penCap);

  const penBand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.068, 0.068, 0.055, 18),
    brass,
  );
  penBand.rotation.z = Math.PI / 2;
  penBand.position.x = -0.67;
  pen.add(penBand);

  const nib = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 12), brass);
  nib.rotation.z = -Math.PI / 2;
  nib.position.x = 1.02;
  nib.castShadow = true;
  pen.add(nib);
  root.add(pen);

  const inkwell = new THREE.Group();
  inkwell.name = 'inkwell';
  inkwell.position.set(-4.35, 0, -0.83);
  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.29, 0.39, 0.34, 8),
    smokedGlass,
  );
  bottle.position.y = 0.17;
  bottle.castShadow = true;
  bottle.receiveShadow = true;
  inkwell.add(bottle);

  const wellShoulder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.25, 0.12, 8),
    brass,
  );
  wellShoulder.position.y = 0.4;
  wellShoulder.castShadow = true;
  inkwell.add(wellShoulder);

  const wellCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 0.12, 12),
    blackLacquer,
  );
  wellCap.position.y = 0.52;
  wellCap.castShadow = true;
  inkwell.add(wellCap);
  root.add(inkwell);

  return {
    root,
    dispose: () => {
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      brass.dispose();
      blackLacquer.dispose();
      smokedGlass.dispose();
      clockIvory.dispose();
    },
  };
}

try {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#182125');
  scene.fog = new THREE.FogExp2('#182125', 0.028);

  const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.05, 80);
  camera.position.set(8.6, 7.25, 10.9);
  scene.add(camera);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.035).texture;
  room.dispose();

  RectAreaLightUniformsLib.init();
  const key = new THREE.RectAreaLight('#ffe5bf', 22, 5.8, 4.1);
  key.position.set(-4.2, 7.7, 5.4);
  key.lookAt(0, 1, 0);
  scene.add(key);

  const softbox = new THREE.SpotLight('#ffd9aa', 40, 24, 0.72, 0.8, 1.4);
  softbox.position.set(-4.7, 8.2, 5.8);
  softbox.target.position.set(0, 1.1, 0.2);
  softbox.castShadow = true;
  softbox.shadow.mapSize.set(2048, 2048);
  softbox.shadow.camera.near = 1;
  softbox.shadow.camera.far = 20;
  softbox.shadow.bias = -0.00035;
  scene.add(softbox, softbox.target);

  const rim = new THREE.DirectionalLight('#bfd8d0', 2.7);
  rim.position.set(5.5, 5, -6);
  scene.add(rim);
  const fill = new THREE.HemisphereLight('#b9c7bf', '#2a160f', 0.94);
  scene.add(fill);

  const walnutTexture = createWalnutTexture(renderer);
  const tableMaterial = new THREE.MeshPhysicalMaterial({
    color: '#352116',
    map: walnutTexture,
    roughness: 0.68,
    clearcoat: 0.08,
    clearcoatRoughness: 0.76,
    specularIntensity: 0.42,
    envMapIntensity: 0.48,
  });
  const table = new THREE.Mesh(new THREE.BoxGeometry(18, 0.56, 13), tableMaterial);
  table.position.set(0, -0.28, 0.5);
  table.receiveShadow = true;
  scene.add(table);

  const contactNote = createContactNote(renderer);
  scene.add(contactNote.mesh);
  const contactNoteDesktopPosition = contactNote.mesh.position.clone();
  const contactNoteDesktopQuaternion = contactNote.mesh.quaternion.clone();

  const setDecor = createSetDecor();
  scene.add(setDecor.root);

  const plasterTexture = createPlasterTexture();
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: '#747a76',
    map: plasterTexture,
    roughness: 0.98,
  });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(46, 24), wallMaterial);
  wall.position.set(0, 5.6, -4.6);
  wall.receiveShadow = true;
  scene.add(wall);

  const phone = createPhoneModel();
  phone.root.rotation.y = -0.08;
  phone.root.position.set(0.35, 0, -0.05);
  scene.add(phone.root);

  const audio = new PhoneAudio();
  document.body.dataset.audioRoute = audio.route;
  const controller = new PhoneController(phone, audio);
  const dialReference = phone.dialPivot.parent ?? phone.root;
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0.2, 0.85, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.minDistance = 9.4;
  controls.maxDistance = 17;
  controls.minPolarAngle = THREE.MathUtils.degToRad(42);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(77);
  controls.minAzimuthAngle = THREE.MathUtils.degToRad(-58);
  controls.maxAzimuthAngle = THREE.MathUtils.degToRad(58);

  const desktopCameraPosition = new THREE.Vector3(8.6, 7.25, 10.9);
  const desktopTarget = new THREE.Vector3(0.2, 0.85, 0);
  const cameraDirection = desktopCameraPosition.clone().sub(desktopTarget).normalize();

  const isCompactViewport = () => (
    window.innerWidth <= 850
    || (window.innerWidth <= 980 && window.innerHeight <= 600)
  );

  const applyResponsiveSceneLayout = () => {
    const compact = isCompactViewport();
    const portrait = compact && window.innerHeight > window.innerWidth;

    if (portrait) {
      const target = new THREE.Vector3(0.22, 1.28, 0.28);
      const aspect = Math.max(window.innerWidth / window.innerHeight, 0.38);
      camera.fov = 44;
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
      const distance = THREE.MathUtils.clamp(
        5.6 / (2 * Math.tan(horizontalFov / 2) * 0.9),
        15.5,
        19,
      );
      controls.target.copy(target);
      camera.position.copy(target).addScaledVector(cameraDirection, distance);
      controls.minDistance = distance * 0.84;
      controls.maxDistance = distance * 1.16;
      contactNote.mesh.position.set(1.72, 0.04, 1.18);
      contactNote.mesh.rotation.set(0, -0.08, 0);
      contactNote.mesh.scale.setScalar(0.58);
    } else if (compact) {
      camera.fov = 34;
      controls.target.set(0.2, 0, 0.15);
      camera.position.copy(controls.target).addScaledVector(cameraDirection, 11.8);
      controls.minDistance = 9.8;
      controls.maxDistance = 15.5;
      contactNote.mesh.position.copy(contactNoteDesktopPosition);
      contactNote.mesh.quaternion.copy(contactNoteDesktopQuaternion);
      contactNote.mesh.scale.setScalar(1);
    } else {
      camera.fov = 34;
      controls.target.copy(desktopTarget);
      camera.position.copy(desktopCameraPosition);
      controls.minDistance = 9.4;
      controls.maxDistance = 17;
      contactNote.mesh.position.copy(contactNoteDesktopPosition);
      contactNote.mesh.quaternion.copy(contactNoteDesktopQuaternion);
      contactNote.mesh.scale.setScalar(1);
    }

    controls.enablePan = !compact;
    controls.rotateSpeed = compact ? 0.48 : 1;
    controls.zoomSpeed = compact ? 0.72 : 1;
    contactNote.mesh.visible = true;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, compact ? 1.65 : 2));
    controls.update();
  };

  applyResponsiveSceneLayout();

  const updateUi = (snapshot: PhoneSnapshot) => {
    document.body.dataset.phoneState = snapshot.state;
    statusLabel.textContent = snapshot.state === 'on-hook'
      ? 'Receiver cradled'
      : snapshot.state === 'dialing'
        ? snapshot.dialPhase === 'held'
          ? snapshot.dialAtStop
            ? `${snapshot.dialDigit} at stop — release`
            : `Turn ${snapshot.dialDigit} clockwise`
          : snapshot.dialPhase === 'returning'
            ? `${snapshot.dialDigit} returning`
            : 'Dial turning'
        : 'Line ready';
    readoutLabel.textContent = snapshot.state === 'dialing'
      ? snapshot.dialPhase === 'held'
        ? snapshot.dialAtStop
          ? `Release ${snapshot.dialDigit} to register`
          : `Turn ${snapshot.dialDigit} to the metal stop`
        : `Registering ${snapshot.dialDigit}`
      : 'Number registered';
    if (snapshot.state === 'on-hook') {
      mobileGuideStep.textContent = '01';
      mobileGuideText.textContent = 'Lift the receiver to begin';
    } else if (snapshot.state === 'off-hook') {
      mobileGuideStep.textContent = '02';
      mobileGuideText.textContent = 'Choose a number and turn clockwise';
    } else if (snapshot.dialPhase === 'held' && snapshot.dialAtStop) {
      mobileGuideStep.textContent = '03';
      mobileGuideText.textContent = `Release ${snapshot.dialDigit} to register`;
    } else if (snapshot.dialPhase === 'held') {
      mobileGuideStep.textContent = '02';
      mobileGuideText.textContent = `Turn ${snapshot.dialDigit} to the metal stop`;
    } else {
      mobileGuideStep.textContent = '03';
      mobileGuideText.textContent = `Let ${snapshot.dialDigit} return`;
    }
    receiverAction.textContent = snapshot.state === 'on-hook' ? 'Lift receiver' : 'Hang up';
    numberDisplay.value = snapshot.digits || '—';
    numberDisplay.textContent = snapshot.digits || '—';
    numberDisplay.dataset.density = snapshot.digits.length >= 13
      ? 'compact'
      : snapshot.digits.length >= 9
        ? 'long'
        : 'standard';
    pulseProgress.style.transform = `translateX(${(snapshot.dialProgress - 1) * 100}%)`;
  };
  controller.subscribe(updateUi);

  receiverButton.addEventListener('click', async () => {
    const audioReady = audio.unlock();
    controller.toggleReceiver();
    const context = await audioReady;
    document.body.dataset.audioState = context?.state ?? 'disabled';
    if (controller.snapshot().state !== 'on-hook') {
      await audio.startDialTone();
      document.body.dataset.lineAudio = audio.lineActive ? 'active' : 'blocked';
    } else {
      document.body.dataset.lineAudio = 'stopped';
    }
  });
  clearButton.addEventListener('click', () => controller.clearDigits());

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const planeNormal = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();
  const localHitPoint = new THREE.Vector3();
  const dialWorldQuaternion = new THREE.Quaternion();
  let activePointer: number | null = null;
  let interaction: 'receiver' | 'dial' | null = null;
  let dialGesture: DialGesture | null = null;

  const setPointer = (event: PointerEvent) => {
    pointer.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
  };

  const belongsToReceiver = (object: THREE.Object3D) => {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current === phone.receiver) return true;
      current = current.parent;
    }
    return false;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (activePointer !== null || event.button !== 0) return;
    void audio.unlock().then((context) => {
      document.body.dataset.audioState = context?.state ?? 'disabled';
    });
    setPointer(event);
    const targets: THREE.Object3D[] = [
      phone.receiver,
      ...phone.dialHitTargets,
      phone.dialTouchTarget,
    ];
    const intersection = raycaster.intersectObjects(targets, true)[0];
    if (!intersection) return;

    const receiverHit = belongsToReceiver(intersection.object);
    let dialDigit: number | null = null;
    if (!receiverHit) {
      localHitPoint.copy(intersection.point);
      dialReference.worldToLocal(localHitPoint);
      const explicitDigit = Number(intersection.object.userData.digit);
      if (Number.isInteger(explicitDigit)) {
        dialDigit = explicitDigit;
      } else {
        let nearestDistance = Number.POSITIVE_INFINITY;
        phone.dialHitTargets.forEach((target) => {
          const distance = Math.hypot(
            localHitPoint.x - target.position.x,
            localHitPoint.y - target.position.y,
          );
          if (distance < nearestDistance) {
            nearestDistance = distance;
            dialDigit = Number(target.userData.digit);
          }
        });
        if (nearestDistance > 0.34) dialDigit = null;
      }
      if (dialDigit === null) return;
    }

    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    controls.enabled = false;

    if (receiverHit) {
      interaction = 'receiver';
      controller.beginReceiverDrag();
      camera.getWorldDirection(planeNormal);
      phone.receiver.getWorldPosition(hitPoint);
      dragPlane.setFromNormalAndCoplanarPoint(planeNormal, hitPoint);
      document.body.style.cursor = 'grabbing';
    } else {
      if (dialDigit === null || !controller.beginDialDrag(dialDigit)) {
        activePointer = null;
        controls.enabled = true;
        canvas.releasePointerCapture(event.pointerId);
        return;
      }
      interaction = 'dial';
      phone.dialPivot.getWorldPosition(hitPoint);
      dialReference.getWorldQuaternion(dialWorldQuaternion);
      planeNormal.set(0, 0, 1).applyQuaternion(dialWorldQuaternion).normalize();
      dragPlane.setFromNormalAndCoplanarPoint(planeNormal, hitPoint);
      localHitPoint.copy(intersection.point);
      dialReference.worldToLocal(localHitPoint);
      dialGesture = beginDialGesture(
        -Math.atan2(localHitPoint.y, localHitPoint.x),
      );
      document.body.style.cursor = 'grabbing';
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    setPointer(event);
    if (activePointer === null || event.pointerId !== activePointer || !interaction) {
      const hoverTargets: THREE.Object3D[] = [
        phone.receiver,
        ...phone.dialHitTargets,
        phone.dialTouchTarget,
      ];
      document.body.style.cursor = raycaster.intersectObjects(hoverTargets, true).length ? 'grab' : '';
      return;
    }

    if (interaction === 'receiver' && raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
      localHitPoint.copy(hitPoint);
      phone.root.worldToLocal(localHitPoint);
      controller.dragReceiver(localHitPoint);
    } else if (interaction === 'dial' && raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
      if (!dialGesture) return;
      localHitPoint.copy(hitPoint);
      dialReference.worldToLocal(localHitPoint);
      if (Math.hypot(localHitPoint.x, localHitPoint.y) < 0.34) return;
      const current = -Math.atan2(localHitPoint.y, localHitPoint.x);
      dialGesture = advanceDialGesture(dialGesture, current);
      controller.dragDial(dialGesture.clockwiseTravel);
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (activePointer === null || event.pointerId !== activePointer) return;
    const audioReady = audio.unlock();
    if (interaction === 'receiver') {
      controller.endReceiverDrag();
    } else if (interaction === 'dial') {
      controller.releaseDial();
    }
    canvas.releasePointerCapture(event.pointerId);
    activePointer = null;
    interaction = null;
    dialGesture = null;
    controls.enabled = true;
    document.body.style.cursor = '';
    if (controller.snapshot().state !== 'on-hook') void audio.startDialTone();
    void audioReady.then((context) => {
      document.body.dataset.audioState = context?.state ?? 'disabled';
      if (controller.snapshot().state !== 'on-hook') void audio.startDialTone();
    });
  };

  const onTouchEndAudio = () => {
    const audioReady = audio.unlock();
    if (controller.snapshot().state !== 'on-hook') void audio.startDialTone();
    void audioReady.then((context) => {
      document.body.dataset.audioState = context?.state ?? 'disabled';
      if (controller.snapshot().state !== 'on-hook') void audio.startDialTone();
    });
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  document.addEventListener('touchend', onTouchEndAudio, { passive: true });

  window.addEventListener('keydown', (event) => {
    void audio.unlock();
    if (/^[0-9]$/.test(event.key)) controller.quickDial(Number(event.key));
    if (event.code === 'Space' && !event.repeat) {
      event.preventDefault();
      void controller.toggleReceiver();
    }
    if (event.key === 'Escape') void controller.hangUp();
    if (event.key === 'Backspace') controller.clearDigits();
  });

  const onResize = () => {
    applyResponsiveSceneLayout();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || controller.snapshot().state === 'on-hook') return;
    void audio.unlock().then(() => audio.startDialTone());
  });

  const timer = new THREE.Timer();
  timer.connect(document);
  let firstFrame = true;
  renderer.setAnimationLoop(() => {
    timer.update();
    const delta = timer.getDelta();
    controller.update(delta);
    controls.update();
    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      requestAnimationFrame(() => {
        document.body.classList.remove('is-booting');
        loading.classList.add('is-hidden');
      });
    }
  });

  window.addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null);
    timer.dispose();
    controls.dispose();
    phone.dispose();
    audio.dispose();
    walnutTexture.dispose();
    plasterTexture.dispose();
    table.geometry.dispose();
    tableMaterial.dispose();
    contactNote.dispose();
    setDecor.dispose();
    wall.geometry.dispose();
    wallMaterial.dispose();
    scene.environment?.dispose();
    pmrem.dispose();
    renderer.dispose();
  }, { once: true });
} catch (error) {
  console.error(error);
  document.body.classList.remove('is-booting');
  loading.classList.add('is-hidden');
  errorPanel.hidden = false;
}
