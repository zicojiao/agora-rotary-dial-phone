import assert from 'node:assert/strict';
import {
  AI_PHONE_NUMBER,
  CALL_LIMIT_SECONDS,
  WRONG_NUMBER_DELAY_MS,
  formatCallTime,
  secondsRemaining,
  shouldRejectNumber,
  shouldStartCall,
} from '../src/callPolicy';

assert.equal(AI_PHONE_NUMBER, '5550193');
assert.equal(CALL_LIMIT_SECONDS, 300);
assert.equal(WRONG_NUMBER_DELAY_MS, 1_500);

assert.equal(shouldStartCall('5550193', 'idle'), true);
assert.equal(shouldStartCall('5550193', 'error'), true);
assert.equal(shouldStartCall('555019', 'idle'), false);
assert.equal(shouldStartCall('5550194', 'idle'), false);
assert.equal(shouldStartCall('5550193', 'connecting'), false);
assert.equal(shouldStartCall('5550193', 'connected'), false);
assert.equal(shouldStartCall('5550193', 'ending'), false);
assert.equal(shouldStartCall('5550193', 'invalid-number'), false);

assert.equal(shouldRejectNumber('5550194', 'idle'), true);
assert.equal(shouldRejectNumber('55501940', 'idle'), true);
assert.equal(shouldRejectNumber('1234567', 'error'), true);
assert.equal(shouldRejectNumber('5550193', 'idle'), false);
assert.equal(shouldRejectNumber('555019', 'idle'), false);
assert.equal(shouldRejectNumber('5550194', 'connecting'), false);
assert.equal(shouldRejectNumber('5550194', 'connected'), false);
assert.equal(shouldRejectNumber('5550194', 'ending'), false);
assert.equal(shouldRejectNumber('5550194', 'invalid-number'), false);

assert.equal(secondsRemaining(301_000, 1_000), 300);
assert.equal(secondsRemaining(301_000, 1_001), 300);
assert.equal(secondsRemaining(301_000, 300_001), 1);
assert.equal(secondsRemaining(301_000, 301_000), 0);
assert.equal(secondsRemaining(301_000, 999_999), 0);

assert.equal(formatCallTime(300), '05:00');
assert.equal(formatCallTime(59), '00:59');
assert.equal(formatCallTime(0), '00:00');
assert.equal(formatCallTime(-10), '00:00');
assert.equal(formatCallTime(500), '05:00');

console.log('Agora call policy checks passed.');
