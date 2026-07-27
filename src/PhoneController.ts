import * as THREE from 'three';
import type { PhoneModel } from './createPhone';
import { PhoneAudio } from './PhoneAudio';

const OFF_HOOK_POSITION = new THREE.Vector3(-1.95, 2.98, 1.55);
const OFF_HOOK_QUATERNION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-0.12, 0.33, THREE.MathUtils.degToRad(36)),
);
const RECEIVER_BODY_EXCLUSION_X = 2.8;
const RECEIVER_BODY_EXCLUSION_Y = 2.82;

export type PhoneState = 'on-hook' | 'off-hook' | 'dialing';

export type PhoneSnapshot = {
  state: PhoneState;
  digits: string;
  dialProgress: number;
  dialDigit: number | null;
  dialPhase: DialMotion['phase'] | null;
  dialAtStop: boolean;
};

type DialMotion = {
  digit: number;
  pulses: number;
  maximum: number;
  angle: number;
  velocity: number;
  phase: 'outbound' | 'held' | 'returning';
  reachedStop: boolean;
  lastPulse: number;
  lastWindNotch: number;
};

export class PhoneController {
  private readonly model: PhoneModel;
  private readonly audio: PhoneAudio;
  private readonly listeners = new Set<(snapshot: PhoneSnapshot) => void>();
  private readonly receiverTarget = new THREE.Vector3();
  private readonly receiverQuaternionTarget = new THREE.Quaternion();
  private readonly receiverVelocity = new THREE.Vector3();
  private receiverDragging = false;
  private dragOriginWasOnHook = false;
  private dialMotion: DialMotion | null = null;
  private digits = '';
  private state: PhoneState = 'on-hook';
  private cordUpdateAccumulator = 0;
  private lastCordPosition = new THREE.Vector3();

  constructor(model: PhoneModel, audio: PhoneAudio) {
    this.model = model;
    this.audio = audio;
    this.receiverTarget.copy(model.receiverHomePosition);
    this.receiverQuaternionTarget.copy(model.receiverHomeQuaternion);
    this.lastCordPosition.copy(model.receiver.position);
  }

  subscribe(listener: (snapshot: PhoneSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): PhoneSnapshot {
    const maximum = this.dialMotion?.maximum ?? 1;
    const angle = this.dialMotion?.angle ?? 0;
    return {
      state: this.state,
      digits: this.digits,
      dialProgress: THREE.MathUtils.clamp(Math.abs(angle / maximum), 0, 1),
      dialDigit: this.dialMotion?.digit ?? null,
      dialPhase: this.dialMotion?.phase ?? null,
      dialAtStop: this.dialMotion?.reachedStop ?? false,
    };
  }

  private emit() {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  pickUp() {
    if (this.state !== 'on-hook') return;
    this.state = 'off-hook';
    this.receiverTarget.copy(OFF_HOOK_POSITION);
    this.receiverQuaternionTarget.copy(OFF_HOOK_QUATERNION);
    this.model.hookSwitches.forEach((hook) => {
      hook.userData.targetY = 2.18;
    });
    void this.audio.playHookClick(true);
    void this.audio.startDialTone();
    this.emit();
  }

  hangUp() {
    if (this.state === 'on-hook') return;
    this.dialMotion = null;
    this.digits = '';
    this.model.dialPivot.rotation.z = 0;
    this.state = 'on-hook';
    this.receiverDragging = false;
    this.receiverTarget.copy(this.model.receiverHomePosition);
    this.receiverQuaternionTarget.copy(this.model.receiverHomeQuaternion);
    this.receiverVelocity.set(0, 0, 0);
    this.model.hookSwitches.forEach((hook) => {
      hook.userData.targetY = 2.02;
    });
    this.audio.stopDialTone();
    void this.audio.playHookClick(false);
    this.emit();
  }

  toggleReceiver() {
    return this.state === 'on-hook' ? this.pickUp() : this.hangUp();
  }

  beginReceiverDrag() {
    this.dragOriginWasOnHook = this.state === 'on-hook';
    this.receiverDragging = true;
    if (this.dragOriginWasOnHook) void this.pickUp();
  }

  dragReceiver(position: THREE.Vector3) {
    if (!this.receiverDragging) return;
    this.receiverTarget.copy(position);
    this.receiverTarget.x = THREE.MathUtils.clamp(this.receiverTarget.x, -4.6, 4.6);
    this.receiverTarget.y = THREE.MathUtils.clamp(this.receiverTarget.y, 1.3, 4.8);
    this.receiverTarget.z = THREE.MathUtils.clamp(this.receiverTarget.z, -0.8, 2.8);
    if (
      this.receiverTarget.y < RECEIVER_BODY_EXCLUSION_Y
      && Math.abs(this.receiverTarget.x) < RECEIVER_BODY_EXCLUSION_X
    ) {
      const currentSide = this.model.receiver.position.x <= 0 ? -1 : 1;
      this.receiverTarget.x = currentSide * RECEIVER_BODY_EXCLUSION_X;
    }
    const lean = THREE.MathUtils.clamp(-this.receiverTarget.x * 0.02, -0.08, 0.08);
    this.receiverQuaternionTarget.setFromEuler(
      new THREE.Euler(-0.12, 0.33 + lean * 0.8, THREE.MathUtils.degToRad(40) + lean),
    );
  }

  endReceiverDrag() {
    if (!this.receiverDragging) return;
    this.receiverDragging = false;
    const distanceHome = this.receiverTarget.distanceTo(this.model.receiverHomePosition);
    if (this.dragOriginWasOnHook && distanceHome < 0.2) {
      this.receiverTarget.copy(OFF_HOOK_POSITION);
      this.receiverQuaternionTarget.copy(OFF_HOOK_QUATERNION);
    } else if (distanceHome < 0.2) {
      void this.hangUp();
    } else {
      this.receiverTarget.y = Math.max(this.receiverTarget.y, 2.32);
    }
    this.dragOriginWasOnHook = false;
  }

  clearDigits() {
    this.digits = '';
    this.emit();
  }

  private dialMaximum(digit: number) {
    return this.model.dialTravelByDigit.get(digit) ?? THREE.MathUtils.degToRad(84);
  }

  quickDial(digit: number) {
    if (this.state === 'on-hook' || this.dialMotion) return false;
    this.audio.stopDialTone();
    const pulses = digit === 0 ? 10 : digit;
    this.dialMotion = {
      digit,
      pulses,
      maximum: this.dialMaximum(digit),
      angle: 0,
      velocity: 0,
      phase: 'outbound',
      reachedStop: true,
      lastPulse: 0,
      lastWindNotch: 0,
    };
    this.state = 'dialing';
    this.emit();
    return true;
  }

  beginDialDrag(digit: number) {
    if (this.state === 'on-hook' || this.dialMotion) return false;
    this.audio.stopDialTone();
    const pulses = digit === 0 ? 10 : digit;
    this.dialMotion = {
      digit,
      pulses,
      maximum: this.dialMaximum(digit),
      angle: 0,
      velocity: 0,
      phase: 'held',
      reachedStop: false,
      lastPulse: 0,
      lastWindNotch: 0,
    };
    this.state = 'dialing';
    this.emit();
    return true;
  }

  dragDial(clockwiseAngle: number) {
    if (!this.dialMotion || this.dialMotion.phase !== 'held') return;
    const nextAngle = THREE.MathUtils.clamp(clockwiseAngle, 0, this.dialMotion.maximum);
    this.dialMotion.angle = Math.max(this.dialMotion.angle, nextAngle);
    if (
      !this.dialMotion.reachedStop
      && this.dialMotion.maximum - this.dialMotion.angle <= THREE.MathUtils.degToRad(1.5)
    ) {
      this.dialMotion.reachedStop = true;
      this.dialMotion.angle = this.dialMotion.maximum;
      void this.audio.playDialStop();
    }
    this.playWindNotch(this.dialMotion);
    this.model.dialPivot.rotation.z = -this.dialMotion.angle;
    this.emit();
  }

  releaseDial() {
    if (!this.dialMotion || this.dialMotion.phase !== 'held') return;
    if (this.dialMotion.angle < THREE.MathUtils.degToRad(9)) {
      this.dialMotion = null;
      this.state = 'off-hook';
      this.model.dialPivot.rotation.z = 0;
      void this.audio.startDialTone();
      this.emit();
      return;
    }
    const returnedAtRelease = 1 - this.dialMotion.angle / this.dialMotion.maximum;
    this.dialMotion.lastPulse = Math.floor(returnedAtRelease * this.dialMotion.pulses);
    this.dialMotion.phase = 'returning';
    this.dialMotion.velocity = 0;
    void this.audio.playDialRelease();
  }

  private completeDial() {
    const motion = this.dialMotion;
    if (!motion) return;
    if (motion.reachedStop) {
      this.digits = `${this.digits}${motion.digit}`.slice(-16);
    } else if (!this.digits) {
      void this.audio.startDialTone();
    }
    this.model.dialPivot.rotation.z = 0;
    this.dialMotion = null;
    this.state = 'off-hook';
    this.emit();
  }

  private playWindNotch(motion: DialMotion) {
    const notch = Math.floor(motion.angle / THREE.MathUtils.degToRad(8.5));
    if (notch > motion.lastWindNotch) {
      motion.lastWindNotch = notch;
      void this.audio.playDialWindTick(notch);
    }
  }

  update(delta: number) {
    const dt = Math.min(delta, 0.034);
    const receiverDelta = this.receiverTarget.clone().sub(this.model.receiver.position);
    this.receiverVelocity.addScaledVector(receiverDelta, 55 * dt);
    this.receiverVelocity.multiplyScalar(Math.exp(-9.2 * dt));
    this.model.receiver.position.addScaledVector(this.receiverVelocity, dt);
    this.model.receiver.quaternion.slerp(this.receiverQuaternionTarget, 1 - Math.exp(-8.5 * dt));

    this.model.hookSwitches.forEach((hook) => {
      const targetY = typeof hook.userData.targetY === 'number' ? hook.userData.targetY : 2.02;
      hook.position.y = THREE.MathUtils.damp(hook.position.y, targetY, 17, dt);
    });

    if (this.dialMotion) {
      const motion = this.dialMotion;
      if (motion.phase === 'outbound') {
        motion.angle = THREE.MathUtils.damp(motion.angle, motion.maximum, 11, dt);
        this.playWindNotch(motion);
        if (motion.maximum - motion.angle < 0.018) {
          motion.angle = motion.maximum;
          motion.reachedStop = true;
          motion.phase = 'returning';
          motion.velocity = 0;
          void this.audio.playDialStop();
          void this.audio.playDialRelease();
        }
      } else if (motion.phase === 'returning') {
        motion.velocity += (7.4 + motion.maximum * 0.38) * dt;
        motion.angle = Math.max(0, motion.angle - motion.velocity * dt);
        const returned = 1 - motion.angle / motion.maximum;
        const pulse = Math.min(motion.pulses, Math.floor(returned * motion.pulses + 0.001));
        if (pulse > motion.lastPulse) {
          motion.lastPulse = pulse;
          void this.audio.playDialTick(0.82 + pulse / motion.pulses * 0.22);
        }
        if (motion.angle <= 0.0001) this.completeDial();
      }
      if (this.dialMotion) {
        this.model.dialPivot.rotation.z = -this.dialMotion.angle;
        this.emit();
      }
    }

    this.cordUpdateAccumulator += dt;
    const receiverMoved = this.lastCordPosition.distanceToSquared(this.model.receiver.position) > 0.0025;
    if (receiverMoved && this.cordUpdateAccumulator > 0.075) {
      this.model.updateCord();
      this.lastCordPosition.copy(this.model.receiver.position);
      this.cordUpdateAccumulator = 0;
    }
  }
}
