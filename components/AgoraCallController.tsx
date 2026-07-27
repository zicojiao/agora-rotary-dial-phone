'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RTMClient } from 'agora-rtm';
import {
  AI_PHONE_NUMBER,
  CALL_LIMIT_SECONDS,
  WRONG_NUMBER_DELAY_MS,
  formatCallTime,
  secondsRemaining as getSecondsRemaining,
  shouldRejectNumber,
  shouldStartCall,
  type CallPhase,
} from '@/src/callPolicy';
import {
  requestAgentStopOnPageExit,
  shouldConfirmCallExit,
} from '@/src/callExitPolicy';
import {
  PHONE_FORCE_HANGUP_EVENT,
  PHONE_SNAPSHOT_EVENT,
  dispatchCallState,
  type PhoneSnapshotEventDetail,
} from '@/src/phoneEvents';
import { ensureMicrophonePermission } from '@/src/microphonePermission';
import type {
  AgentResponse,
  AgoraRenewalTokens,
  AgoraTokenData,
  ClientStartRequest,
  MicrophoneRuntimeState,
} from '@/types/conversation';

const AgoraCallRuntime = dynamic(() => import('./AgoraCallRuntime'), {
  ssr: false,
});

const AgoraProvider = dynamic(
  async () => {
    const { AgoraRTCProvider, default: AgoraRTC } =
      await import('agora-rtc-react');
    return {
      default: function AgoraRuntimeProvider({
        children,
      }: {
        children: React.ReactNode;
      }) {
        const clientRef = useRef<ReturnType<
          typeof AgoraRTC.createClient
        > | null>(null);
        if (!clientRef.current) {
          clientRef.current = AgoraRTC.createClient({
            mode: 'rtc',
            codec: 'vp8',
          });
        }
        return (
          <AgoraRTCProvider client={clientRef.current}>
            {children}
          </AgoraRTCProvider>
        );
      },
    };
  },
  { ssr: false },
);

type ActiveSession = {
  agoraData: AgoraTokenData;
  rtmClient: RTMClient;
};

type ConnectionStep = 'permission' | 'agent' | 'microphone';

async function parseError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || fallback;
  } catch {
    return fallback;
  }
}

export default function AgoraCallController() {
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [remaining, setRemaining] = useState(CALL_LIMIT_SECONDS);
  const [errorMessage, setErrorMessage] = useState('');
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [connectionStep, setConnectionStep] =
    useState<ConnectionStep>('permission');
  const phaseRef = useRef<CallPhase>('idle');
  const sessionRef = useRef<ActiveSession | null>(null);
  const lifecycleRef = useRef(0);
  const deadlineRef = useRef(0);
  const stopPromiseRef = useRef<Promise<void> | null>(null);
  const wrongNumberTimerRef = useRef<number | null>(null);
  const pendingAgentIdRef = useRef<string | null>(null);

  const clearWrongNumberTimer = useCallback(() => {
    if (wrongNumberTimerRef.current === null) return;
    window.clearTimeout(wrongNumberTimerRef.current);
    wrongNumberTimerRef.current = null;
  }, []);

  const publishState = useCallback(
    (nextPhase: CallPhase, nextRemaining = remaining, error?: string) => {
      phaseRef.current = nextPhase;
      setPhase(nextPhase);
      setRemaining(nextRemaining);
      setErrorMessage(error ?? '');
      dispatchCallState({
        phase: nextPhase,
        secondsRemaining: nextRemaining,
        error,
      });
    },
    [remaining],
  );

  const stopAgent = useCallback(async (agentId: string) => {
    try {
      const response = await fetch('/api/stop-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
        keepalive: true,
      });
      if (!response.ok) {
        console.error(
          'Agora agent stop failed:',
          await parseError(response, 'Unknown stop error.'),
        );
      }
    } catch (error) {
      console.error('Agora agent stop request failed:', error);
    }
  }, []);

  const cleanupSession = useCallback(
    async (activeSession: ActiveSession | null) => {
      if (!activeSession) return;
      await Promise.allSettled([
        stopAgent(activeSession.agoraData.agentId),
        activeSession.rtmClient.logout(),
      ]);
    },
    [stopAgent],
  );

  const finishCall = useCallback(
    (returnReceiver: boolean) => {
      if (stopPromiseRef.current) return stopPromiseRef.current;
      if (
        phaseRef.current === 'idle' &&
        !sessionRef.current &&
        !pendingAgentIdRef.current
      ) {
        if (returnReceiver) {
          window.dispatchEvent(new Event(PHONE_FORCE_HANGUP_EVENT));
        }
        return Promise.resolve();
      }

      lifecycleRef.current += 1;
      publishState('ending', remaining);
      const activeSession = sessionRef.current;
      const pendingAgentId = pendingAgentIdRef.current;
      sessionRef.current = null;
      pendingAgentIdRef.current = null;
      setSession(null);

      const operation = Promise.allSettled([
        cleanupSession(activeSession),
        pendingAgentId
          ? stopAgent(pendingAgentId)
          : Promise.resolve(),
      ]).then(() => undefined).finally(() => {
        deadlineRef.current = 0;
        publishState('idle', CALL_LIMIT_SECONDS);
        if (returnReceiver) {
          window.dispatchEvent(new Event(PHONE_FORCE_HANGUP_EVENT));
        }
        stopPromiseRef.current = null;
      });
      stopPromiseRef.current = operation;
      return operation;
    },
    [cleanupSession, publishState, remaining, stopAgent],
  );

  const startCall = useCallback(
    async (digits: string) => {
      if (!shouldStartCall(digits, phaseRef.current) || stopPromiseRef.current) {
        return;
      }

      clearWrongNumberTimer();
      const lifecycle = ++lifecycleRef.current;
      setConnectionStep('permission');
      publishState('connecting', CALL_LIMIT_SECONDS);

      try {
        await ensureMicrophonePermission(navigator.mediaDevices);
        if (
          lifecycle !== lifecycleRef.current ||
          phaseRef.current !== 'connecting'
        ) {
          return;
        }

        setConnectionStep('agent');
        const tokenResponse = await fetch('/api/generate-agora-token');
        if (!tokenResponse.ok) {
          throw new Error(
            await parseError(tokenResponse, 'Could not open the Agora line.'),
          );
        }
        const tokenData = (await tokenResponse.json()) as Omit<
          AgoraTokenData,
          'agentId'
        >;

        const agentPromise = fetch('/api/invite-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requester_id: tokenData.uid,
            channel_name: tokenData.channel,
          } satisfies ClientStartRequest),
        }).then(async (response) => {
          if (!response.ok) {
            throw new Error(
              await parseError(response, 'The Agora AI agent did not answer.'),
            );
          }
          const result = (await response.json()) as AgentResponse;
          pendingAgentIdRef.current = result.agent_id;
          return result;
        });

        const rtmPromise = (async () => {
          const { default: AgoraRTM } = await import('agora-rtm');
          const rtmClient: RTMClient = new AgoraRTM.RTM(
            process.env.NEXT_PUBLIC_AGORA_APP_ID!,
            tokenData.uid,
          );
          await rtmClient.login({ token: tokenData.token });
          await rtmClient.subscribe(tokenData.channel);
          return rtmClient;
        })();

        const [agentResult, rtmResult] = await Promise.allSettled([
          agentPromise,
          rtmPromise,
        ]);

        if (
          lifecycle !== lifecycleRef.current ||
          phaseRef.current !== 'connecting'
        ) {
          if (
            agentResult.status === 'fulfilled' &&
            pendingAgentIdRef.current === agentResult.value.agent_id
          ) {
            pendingAgentIdRef.current = null;
          }
          await Promise.allSettled([
            agentResult.status === 'fulfilled'
              ? stopAgent(agentResult.value.agent_id)
              : Promise.resolve(),
            rtmResult.status === 'fulfilled'
              ? rtmResult.value.logout()
              : Promise.resolve(),
          ]);
          return;
        }

        if (agentResult.status === 'rejected' || rtmResult.status === 'rejected') {
          if (
            agentResult.status === 'fulfilled' &&
            pendingAgentIdRef.current === agentResult.value.agent_id
          ) {
            pendingAgentIdRef.current = null;
          }
          await Promise.allSettled([
            agentResult.status === 'fulfilled'
              ? stopAgent(agentResult.value.agent_id)
              : Promise.resolve(),
            rtmResult.status === 'fulfilled'
              ? rtmResult.value.logout()
              : Promise.resolve(),
          ]);
          const failure =
            agentResult.status === 'rejected'
              ? agentResult.reason
              : rtmResult.status === 'rejected'
                ? rtmResult.reason
                : null;
          throw failure;
        }

        const activeSession: ActiveSession = {
          agoraData: {
            ...tokenData,
            agentId: agentResult.value.agent_id,
          },
          rtmClient: rtmResult.value,
        };
        pendingAgentIdRef.current = null;
        sessionRef.current = activeSession;
        setSession(activeSession);
      } catch (error) {
        if (lifecycle !== lifecycleRef.current) return;
        const message =
          error instanceof Error
            ? error.message
            : 'The Agora AI line could not be connected.';
        publishState('error', CALL_LIMIT_SECONDS, message);
      }
    },
    [clearWrongNumberTimer, publishState, stopAgent],
  );

  useEffect(() => {
    const handlePhoneSnapshot = (event: Event) => {
      const detail = (event as CustomEvent<PhoneSnapshotEventDetail>).detail;
      if (!detail) return;

      clearWrongNumberTimer();

      if (detail.state === 'on-hook') {
        if (phaseRef.current !== 'idle' || sessionRef.current) {
          void finishCall(false);
        }
        return;
      }

      if (
        !detail.digits
        && (
          phaseRef.current === 'error'
          || phaseRef.current === 'invalid-number'
        )
      ) {
        publishState('idle', CALL_LIMIT_SECONDS);
        return;
      }

      if (detail.digits === AI_PHONE_NUMBER) {
        void startCall(detail.digits);
        return;
      }

      if (shouldRejectNumber(detail.digits, phaseRef.current)) {
        wrongNumberTimerRef.current = window.setTimeout(() => {
          wrongNumberTimerRef.current = null;
          if (!shouldRejectNumber(detail.digits, phaseRef.current)) return;
          publishState(
            'invalid-number',
            CALL_LIMIT_SECONDS,
            'Clear the number and dial 555-0193 again.',
          );
        }, WRONG_NUMBER_DELAY_MS);
      }
    };

    window.addEventListener(PHONE_SNAPSHOT_EVENT, handlePhoneSnapshot);
    return () => {
      window.removeEventListener(PHONE_SNAPSHOT_EVENT, handlePhoneSnapshot);
      clearWrongNumberTimer();
    };
  }, [
    clearWrongNumberTimer,
    finishCall,
    publishState,
    startCall,
  ]);

  const handleConnected = useCallback(() => {
    if (phaseRef.current !== 'connecting') return;
    deadlineRef.current = Date.now() + CALL_LIMIT_SECONDS * 1000;
    publishState('connected', CALL_LIMIT_SECONDS);
  }, [publishState]);

  const handleMicrophoneState = useCallback(
    (state: MicrophoneRuntimeState) => {
      if (phaseRef.current !== 'connecting') return;
      if (state === 'ready') return;
      setConnectionStep('microphone');
    },
    [],
  );

  const handleRuntimeError = useCallback(
    (message: string) => {
      if (phaseRef.current === 'ending' || phaseRef.current === 'idle') return;
      publishState('error', remaining, message);
      void finishCall(true);
    },
    [finishCall, publishState, remaining],
  );

  const renewTokens = useCallback(
    async (rtcUid: string): Promise<AgoraRenewalTokens> => {
      const activeSession = sessionRef.current;
      if (!activeSession) throw new Error('The call session is no longer active.');
      const { channel, uid: rtmUid } = activeSession.agoraData;
      const [rtcResponse, rtmResponse] = await Promise.all([
        fetch(`/api/generate-agora-token?channel=${channel}&uid=${rtcUid}`),
        fetch(`/api/generate-agora-token?channel=${channel}&uid=${rtmUid}`),
      ]);
      if (!rtcResponse.ok || !rtmResponse.ok) {
        throw new Error('Agora token renewal failed.');
      }
      const [rtcData, rtmData] = await Promise.all([
        rtcResponse.json() as Promise<{ token: string }>,
        rtmResponse.json() as Promise<{ token: string }>,
      ]);
      return { rtcToken: rtcData.token, rtmToken: rtmData.token };
    },
    [],
  );

  useEffect(() => {
    if (phase !== 'connected') return;
    const tick = () => {
      const nextRemaining = getSecondsRemaining(
        deadlineRef.current,
        Date.now(),
      );
      setRemaining(nextRemaining);
      dispatchCallState({
        phase: 'connected',
        secondsRemaining: nextRemaining,
      });
      if (nextRemaining === 0) {
        void finishCall(true);
      }
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [finishCall, phase]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !shouldConfirmCallExit(
          phaseRef.current,
          Boolean(sessionRef.current),
        )
      ) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    };

    const handlePageHide = () => {
      lifecycleRef.current += 1;
      const activeSession = sessionRef.current;
      const agentId =
        activeSession?.agoraData.agentId ??
        pendingAgentIdRef.current;
      if (!agentId) return;
      requestAgentStopOnPageExit(agentId, {
        sendBeacon: navigator.sendBeacon.bind(navigator),
        fetch: window.fetch.bind(window),
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  return (
    <>
      {session ? (
        <AgoraProvider>
          <AgoraCallRuntime
            agoraData={session.agoraData}
            rtmClient={session.rtmClient}
            onConnected={handleConnected}
            onAgentLeft={() => handleRuntimeError('The Agora AI agent left the line.')}
            onMicrophoneState={handleMicrophoneState}
            onRuntimeError={handleRuntimeError}
            onTokenWillExpire={renewTokens}
          />
        </AgoraProvider>
      ) : null}

      {phase !== 'idle' ? (
        <aside
          className={`ai-call-panel is-${phase} ${
            remaining <= 60 ? 'is-warning' : ''
          }`}
          aria-live="polite"
          aria-label="Agora AI call status"
        >
          <span className="ai-call-kicker">Agora AI line</span>
          <strong>
            {phase === 'connecting'
              ? connectionStep === 'permission'
                ? 'Allow microphone access'
                : connectionStep === 'agent'
                  ? 'Calling Agora AI…'
                  : 'Preparing microphone…'
              : phase === 'connected'
                ? 'AI call connected'
                : phase === 'ending'
                  ? 'Ending call…'
                  : phase === 'invalid-number'
                    ? 'Number not in service'
                  : 'Line unavailable'}
          </strong>
          {phase === 'connected' ? (
            <>
              <time>{formatCallTime(remaining)}</time>
              <small>5 minute maximum</small>
            </>
          ) : null}
          {phase === 'connecting' && connectionStep === 'permission' ? (
            <small>Choose Allow so the AI can hear you.</small>
          ) : null}
          {phase === 'connecting' && connectionStep === 'microphone' ? (
            <small>You can speak when the call shows connected.</small>
          ) : null}
          {(phase === 'error' || phase === 'invalid-number') && errorMessage ? (
            <small>{errorMessage}</small>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}
