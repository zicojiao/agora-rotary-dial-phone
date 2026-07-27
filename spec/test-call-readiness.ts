import assert from 'node:assert/strict';
import { isCallReady, type CallReadiness } from '../src/callReadiness';

const ready: CallReadiness = {
  agentPresent: true,
  rtcConnected: true,
  hasMicrophoneTrack: true,
  microphoneLoading: false,
  publishLoading: false,
  microphonePublished: true,
};

assert.equal(isCallReady(ready), true);

for (const key of [
  'agentPresent',
  'rtcConnected',
  'hasMicrophoneTrack',
  'microphonePublished',
] as const) {
  assert.equal(isCallReady({ ...ready, [key]: false }), false, key);
}

for (const key of ['microphoneLoading', 'publishLoading'] as const) {
  assert.equal(isCallReady({ ...ready, [key]: true }), false, key);
}

console.log('Agora call readiness checks passed.');
