import type { CallPhase } from './callPolicy';

export const PHONE_SNAPSHOT_EVENT = 'rotary-phone:snapshot';
export const PHONE_FORCE_HANGUP_EVENT = 'rotary-phone:force-hangup';
export const CALL_STATE_EVENT = 'rotary-phone:call-state';

export type PhoneSnapshotEventDetail = {
  state: 'on-hook' | 'off-hook' | 'dialing';
  digits: string;
};

export type CallStateEventDetail = {
  phase: CallPhase;
  secondsRemaining: number;
  error?: string;
};

export function dispatchCallState(detail: CallStateEventDetail) {
  window.dispatchEvent(
    new CustomEvent<CallStateEventDetail>(CALL_STATE_EVENT, { detail }),
  );
}
