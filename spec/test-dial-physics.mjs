import assert from 'node:assert/strict';
import {
  advanceDialGesture,
  beginDialGesture,
  clockwiseTravelToStop,
} from '../src/dialPhysics.ts';

const degrees = (value) => value * Math.PI / 180;
const roundedDegrees = (value) => Math.round(value * 180 / Math.PI);
const stopPosition = { x: 0.92, y: -0.75 };
const stopRotation = -0.74;
const stopAngle = Math.atan2(
  stopPosition.y + Math.cos(stopRotation) * 0.31,
  stopPosition.x - Math.sin(stopRotation) * 0.31,
);

assert.equal(roundedDegrees(clockwiseTravelToStop(degrees(45), stopAngle)), 70);
assert.equal(roundedDegrees(clockwiseTravelToStop(degrees(285), stopAngle)), 310);
assert.equal(roundedDegrees(clockwiseTravelToStop(degrees(315), stopAngle)), 340);

let gesture = beginDialGesture(degrees(-30));
gesture = advanceDialGesture(gesture, degrees(-70));
assert.equal(gesture.clockwiseTravel, 0, 'Counter-clockwise input must not move the dial.');

gesture = advanceDialGesture(gesture, degrees(-30));
assert.equal(gesture.clockwiseTravel, 0, 'Returning to the start must not ratchet the dial.');

gesture = advanceDialGesture(gesture, degrees(15));
assert.equal(
  roundedDegrees(gesture.clockwiseTravel),
  45,
  'Only clockwise travel beyond the starting point advances the dial.',
);

const beforeReverse = gesture.clockwiseTravel;
gesture = advanceDialGesture(gesture, degrees(-5));
assert.equal(
  gesture.clockwiseTravel,
  beforeReverse,
  'Reverse motion cannot unwind a dial that is already turned.',
);

console.log('Dial physics checks passed.');
