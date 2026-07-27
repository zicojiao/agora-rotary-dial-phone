export const AI_PHONE_NUMBER = '5550193';
export const CALL_LIMIT_SECONDS = 5 * 60;
export const WRONG_NUMBER_DELAY_MS = 1_500;

export type CallPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'ending'
  | 'invalid-number'
  | 'error';

export function shouldStartCall(digits: string, phase: CallPhase) {
  return (
    digits === AI_PHONE_NUMBER &&
    (phase === 'idle' || phase === 'error')
  );
}

export function shouldRejectNumber(digits: string, phase: CallPhase) {
  return (
    digits.length >= AI_PHONE_NUMBER.length &&
    digits !== AI_PHONE_NUMBER &&
    (phase === 'idle' || phase === 'error')
  );
}

export function secondsRemaining(deadline: number, now: number) {
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function formatCallTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.min(CALL_LIMIT_SECONDS, Math.floor(seconds)));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
