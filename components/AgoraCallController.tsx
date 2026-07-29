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
import { settleOptionalOperation } from '@/src/optionalOperation';
import type {
  AgentResponse,
  AgoraTokenData,
  AgoraTokenIssue,
  ClientStartRequest,
  MicrophoneRuntimeState,
  StopConversationRequest,
} from '@/types/conversation';

const AgoraCallRuntime = dynamic(() => import('./AgoraCallRuntime'), {
  ssr: false,
});

const RTM_CONNECT_TIMEOUT_MS = 5_000;

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
  rtmClient: RTMClient | null;
};

/** An agent that started before the session was assembled, or torn down. */
type PendingAgent = {
  agentId: string;
  stopToken: string;
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
  // Mirrors `remaining` so the callbacks handed to the runtime stay referentially
  // stable — a countdown tick must not tear down and re-init the Agora runtime.
  const remainingRef = useRef(CALL_LIMIT_SECONDS);
  const sessionRef = useRef<ActiveSession | null>(null);
  const lifecycleRef = useRef(0);
  const deadlineRef = useRef(0);
  const stopPromiseRef = useRef<Promise<void> | null>(null);
  const wrongNumberTimerRef = useRef<number | null>(null);
  const pendingAgentRef = useRef<PendingAgent | null>(null);

  const clearWrongNumberTimer = useCallback(() => {
    if (wrongNumberTimerRef.current === null) return;
    window.clearTimeout(wrongNumberTimerRef.current);
    wrongNumberTimerRef.current = null;
  }, []);

  const publishState = useCallback(
    (
      nextPhase: CallPhase,
      nextRemaining = remainingRef.current,
      error?: string,
    ) => {
      phaseRef.current = nextPhase;
      remainingRef.current = nextRemaining;
      setPhase(nextPhase);
      setRemaining(nextRemaining);
      setErrorMessage(error ?? '');
      dispatchCallState({
        phase: nextPhase,
        secondsRemaining: nextRemaining,
        error,
      });
    },
    [],
  );

  const stopAgent = useCallback(async (agent: PendingAgent) => {
    try {
      const response = await fetch('/api/stop-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agent.agentId,
          stop_token: agent.stopToken,
        } satisfies StopConversationRequest),
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
      const { agentId, stopToken } = activeSession.agoraData;
      await Promise.allSettled([
        stopAgent({ agentId, stopToken }),
        activeSession.rtmClient?.logout() ?? Promise.resolve(),
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
        !pendingAgentRef.current
      ) {
        if (returnReceiver) {
          window.dispatchEvent(new Event(PHONE_FORCE_HANGUP_EVENT));
        }
        return Promise.resolve();
      }

      lifecycleRef.current += 1;
      publishState('ending', remainingRef.current);
      const activeSession = sessionRef.current;
      const pendingAgent = pendingAgentRef.current;
      sessionRef.current = null;
      pendingAgentRef.current = null;
      setSession(null);

      const operation = Promise.allSettled([
        cleanupSession(activeSession),
        pendingAgent ? stopAgent(pendingAgent) : Promise.resolve(),
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
    [cleanupSession, publishState, stopAgent],
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
        const tokenData = (await tokenResponse.json()) as AgoraTokenIssue;

        const agentPromise = fetch('/api/invite-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requester_id: tokenData.uid,
            channel_name: tokenData.channel,
            ticket: tokenData.ticket,
          } satisfies ClientStartRequest),
        }).then(async (response) => {
          if (!response.ok) {
            throw new Error(
              await parseError(response, 'The Agora AI agent did not answer.'),
            );
          }
          const result = (await response.json()) as AgentResponse;
          const agent: PendingAgent = {
            agentId: result.agent_id,
            stopToken: result.stop_token,
          };
          pendingAgentRef.current = agent;
          return agent;
        });

        const rtmPromise = (async () => {
          const { default: AgoraRTM } = await import('agora-rtm');
          const rtmClient: RTMClient = new AgoraRTM.RTM(
            process.env.NEXT_PUBLIC_AGORA_APP_ID!,
            tokenData.uid,
          );
          try {
            await rtmClient.login({ token: tokenData.token });
            await rtmClient.subscribe(tokenData.channel);
            return rtmClient;
          } catch (error) {
            await rtmClient.logout().catch(() => undefined);
            throw error;
          }
        })();
        const optionalRtmPromise = settleOptionalOperation(
          rtmPromise,
          RTM_CONNECT_TIMEOUT_MS,
          (lateClient) => lateClient.logout(),
        );

        const [agentResult, rtmResult] = await Promise.allSettled([
          agentPromise,
          optionalRtmPromise,
        ]);
        const rtmSetup =
          rtmResult.status === 'fulfilled'
            ? rtmResult.value
            : { status: 'rejected' as const, error: rtmResult.reason };
        const connectedRtmClient =
          rtmSetup.status === 'available' ? rtmSetup.value : null;
        if (rtmSetup.status !== 'available') {
          console.warn(
            rtmSetup.status === 'timeout'
              ? 'Agora RTM connection timed out; continuing with RTC audio only.'
              : 'Agora RTM connection failed; continuing with RTC audio only.',
            rtmSetup.status === 'rejected' ? rtmSetup.error : undefined,
          );
        }

        // Whatever half of the handshake succeeded has to be torn down again
        // when the caller hangs up mid-connect or the other half fails.
        const abandonPartialSetup = async () => {
          const startedAgent =
            agentResult.status === 'fulfilled' ? agentResult.value : null;
          if (
            startedAgent &&
            pendingAgentRef.current?.agentId === startedAgent.agentId
          ) {
            pendingAgentRef.current = null;
          }
          await Promise.allSettled([
            startedAgent ? stopAgent(startedAgent) : Promise.resolve(),
            connectedRtmClient?.logout() ?? Promise.resolve(),
          ]);
        };

        if (
          lifecycle !== lifecycleRef.current ||
          phaseRef.current !== 'connecting'
        ) {
          await abandonPartialSetup();
          return;
        }

        if (agentResult.status === 'rejected') {
          await abandonPartialSetup();
          throw agentResult.reason;
        }

        const activeSession: ActiveSession = {
          agoraData: {
            ...tokenData,
            agentId: agentResult.value.agentId,
            stopToken: agentResult.value.stopToken,
          },
          rtmClient: connectedRtmClient,
        };
        pendingAgentRef.current = null;
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

      if (detail.receiverState === 'on-hook') {
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
      publishState('error', remainingRef.current, message);
      void finishCall(true);
    },
    [finishCall, publishState],
  );

  const handleAgentLeft = useCallback(() => {
    handleRuntimeError('The Agora AI agent left the line.');
  }, [handleRuntimeError]);

  const renewToken = useCallback(async (): Promise<string> => {
    const activeSession = sessionRef.current;
    if (!activeSession) throw new Error('The call session is no longer active.');
    // The ticket carries the channel and uid, so renewal cannot be pointed at
    // another line. One combined token serves both RTC and RTM, as at join.
    const response = await fetch(
      `/api/generate-agora-token?ticket=${encodeURIComponent(
        activeSession.agoraData.ticket,
      )}`,
    );
    if (!response.ok) {
      throw new Error(await parseError(response, 'Agora token renewal failed.'));
    }
    const renewed = (await response.json()) as AgoraTokenIssue;
    return renewed.token;
  }, []);

  useEffect(() => {
    if (phase !== 'connected') return;
    const tick = () => {
      const nextRemaining = getSecondsRemaining(
        deadlineRef.current,
        Date.now(),
      );
      remainingRef.current = nextRemaining;
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
      const agent: PendingAgent | null = activeSession
        ? {
            agentId: activeSession.agoraData.agentId,
            stopToken: activeSession.agoraData.stopToken,
          }
        : pendingAgentRef.current;
      if (!agent) return;
      requestAgentStopOnPageExit(agent.agentId, agent.stopToken, {
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
            onAgentLeft={handleAgentLeft}
            onMicrophoneState={handleMicrophoneState}
            onRuntimeError={handleRuntimeError}
            onTokenWillExpire={renewToken}
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
              {session && !session.rtmClient ? (
                <small>Voice connected without live AI status.</small>
              ) : null}
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
