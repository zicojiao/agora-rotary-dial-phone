import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { PhoneAudio } from '../src/PhoneAudio';
import { PhoneController } from '../src/PhoneController';
import type { PhoneModel } from '../src/createPhone';

const pressDigits: number[] = [];
let stopCount = 0;
let registeredCount = 0;

const audio = {
  confirmDialDigit() {
    registeredCount += 1;
  },
  playDialPress(digit: number) {
    pressDigits.push(digit);
    return Promise.resolve();
  },
  playDialRelease: () => Promise.resolve(),
  playDialStop() {
    stopCount += 1;
    return Promise.resolve();
  },
  playDialTick: () => Promise.resolve(),
  playDialWindTick: () => Promise.resolve(),
  playHookClick: () => Promise.resolve(),
  startDialTone: () => Promise.resolve(),
  startLineAmbience: () => Promise.resolve(),
  stopDialTone() {},
  stopLineAmbience() {},
} as unknown as PhoneAudio;

const receiver = new THREE.Group();
const model = {
  dialPivot: new THREE.Group(),
  dialTravelByDigit: new Map([[5, THREE.MathUtils.degToRad(180)]]),
  hookSwitches: [],
  receiver,
  receiverHomePosition: receiver.position.clone(),
  receiverHomeQuaternion: receiver.quaternion.clone(),
  updateCord() {},
} as unknown as PhoneModel;

const controller = new PhoneController(model, audio);

const advanceUntilSettled = () => {
  for (
    let frame = 0;
    frame < 240 && controller.snapshot().state === 'dialing';
    frame += 1
  ) {
    controller.update(1 / 60);
  }
};

assert.equal(controller.snapshot().receiverState, 'on-hook');
assert.equal(controller.beginDialDrag(5), true);
assert.deepEqual(pressDigits, [5], 'pressing a digit should play immediate feedback');
controller.dragDial(THREE.MathUtils.degToRad(180));
controller.releaseDial();
advanceUntilSettled();
assert.equal(controller.snapshot().state, 'on-hook');
assert.equal(controller.snapshot().receiverState, 'on-hook');
assert.equal(
  controller.snapshot().digits,
  '',
  'an on-hook mechanical dial must not register a digit',
);
assert.equal(registeredCount, 0);
assert.equal(stopCount, 1);

assert.equal(controller.quickDial(5), true);
advanceUntilSettled();
assert.equal(controller.snapshot().receiverState, 'on-hook');
assert.equal(controller.snapshot().digits, '');
assert.equal(registeredCount, 0);
assert.equal(stopCount, 2);

controller.pickUp();
assert.equal(controller.snapshot().receiverState, 'off-hook');
assert.equal(controller.beginDialDrag(5), true);
assert.deepEqual(pressDigits, [5, 5, 5]);
controller.releaseDial();
assert.equal(controller.snapshot().digits, '');
assert.equal(
  registeredCount,
  0,
  'a tap without rotation must not register or confirm a digit',
);

assert.equal(controller.beginDialDrag(5), true);
controller.dragDial(THREE.MathUtils.degToRad(180));
assert.equal(stopCount, 3, 'the metal-stop sound should play once at the stop');
controller.dragDial(THREE.MathUtils.degToRad(180));
assert.equal(stopCount, 3, 'holding at the stop must not repeat the impact');
controller.releaseDial();

advanceUntilSettled();

assert.equal(controller.snapshot().digits, '5');
assert.equal(controller.snapshot().receiverState, 'off-hook');
assert.equal(registeredCount, 1, 'a completed return should confirm the digit once');
assert.deepEqual(pressDigits, [5, 5, 5, 5]);

console.log('Phone controller audio checks passed.');
