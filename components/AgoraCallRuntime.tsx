'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RemoteUser,
  useClientEvent,
  useJoin,
  useLocalMicrophoneTrack,
  usePublish,
  useRemoteUsers,
  useRTCClient,
} from 'agora-rtc-react';
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  TranscriptHelperMode,
} from 'agora-agent-client-toolkit';
import { DEFAULT_AGENT_UID } from '@/lib/agora';
import { isCallReady } from '@/src/callReadiness';
import type { AgoraRuntimeProps } from '@/types/conversation';

export default function AgoraCallRuntime({
  agoraData,
  rtmClient,
  onConnected,
  onAgentLeft,
  onMicrophoneState,
  onRuntimeError,
  onTokenWillExpire,
}: AgoraRuntimeProps) {
  const client = useRTCClient();
  const remoteUsers = useRemoteUsers();
  const [isReady, setIsReady] = useState(false);
  const callWasReady = useRef(false);
  const agentUid =
    process.env.NEXT_PUBLIC_AGENT_UID ?? String(DEFAULT_AGENT_UID);
  const agentPresent = remoteUsers.some(
    (user) => String(user.uid) === agentUid,
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) setIsReady(true);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setIsReady(false);
    };
  }, []);

  const { isConnected: rtcConnected, error: joinError } = useJoin(
    {
      appid: process.env.NEXT_PUBLIC_AGORA_APP_ID!,
      channel: agoraData.channel,
      token: agoraData.token,
      uid: Number.parseInt(agoraData.uid, 10),
    },
    isReady,
  );

  const {
    localMicrophoneTrack,
    isLoading: microphoneLoading,
    error: microphoneError,
  } = useLocalMicrophoneTrack(isReady);
  const {
    isLoading: publishLoading,
    error: publishError,
  } = usePublish(
    [localMicrophoneTrack],
    Boolean(localMicrophoneTrack && rtcConnected),
  );

  const microphonePublished = Boolean(
    localMicrophoneTrack &&
      client.localTracks.some(
        (track) => track.getTrackId() === localMicrophoneTrack.getTrackId(),
      ),
  );
  const callReady = isCallReady({
    agentPresent,
    rtcConnected,
    hasMicrophoneTrack: Boolean(localMicrophoneTrack),
    microphoneLoading,
    publishLoading,
    microphonePublished,
  });

  useEffect(() => {
    if (microphonePublished && !publishLoading) {
      onMicrophoneState('ready');
    } else if (localMicrophoneTrack) {
      onMicrophoneState('publishing');
    } else {
      onMicrophoneState('requesting');
    }
  }, [
    localMicrophoneTrack,
    microphonePublished,
    onMicrophoneState,
    publishLoading,
  ]);

  useEffect(() => {
    const runtimeError = joinError ?? microphoneError ?? publishError;
    if (!runtimeError) return;
    onRuntimeError(runtimeError.message || 'Agora media setup failed.');
  }, [joinError, microphoneError, onRuntimeError, publishError]);

  useEffect(() => {
    if (!isReady || !rtcConnected) return;
    let cancelled = false;

    void (async () => {
      try {
        const voiceAi = await AgoraVoiceAI.init({
          rtcEngine: client,
          ...(rtmClient
            ? { rtmConfig: { rtmEngine: rtmClient } }
            : {}),
          renderMode: TranscriptHelperMode.TEXT,
          enableLog: false,
        });
        if (cancelled) {
          if (AgoraVoiceAI.getInstance() === voiceAi) {
            voiceAi.unsubscribe();
            voiceAi.destroy();
          }
          return;
        }
        voiceAi.on(AgoraVoiceAIEvents.AGENT_ERROR, (_, error) => {
          onRuntimeError(error.message || 'The Agora agent reported an error.');
        });
        voiceAi.on(AgoraVoiceAIEvents.MESSAGE_ERROR, (_, error) => {
          console.warn(
            'Agora RTM message channel degraded; RTC audio remains active.',
            error,
          );
        });
        voiceAi.subscribeMessage(agoraData.channel);
      } catch (error) {
        if (!cancelled) {
          console.warn(
            'Agora voice status features are unavailable; RTC audio remains active.',
            error,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        const voiceAi = AgoraVoiceAI.getInstance();
        voiceAi?.unsubscribe();
        voiceAi?.destroy();
      } catch {
        // The toolkit is already gone.
      }
    };
  }, [
    agoraData.channel,
    client,
    isReady,
    onRuntimeError,
    rtcConnected,
    rtmClient,
  ]);

  useEffect(() => {
    if (callReady && !callWasReady.current) {
      callWasReady.current = true;
      onConnected();
    }
  }, [callReady, onConnected]);

  useClientEvent(client, 'user-left', (user) => {
    if (
      String(user.uid) === agentUid &&
      callWasReady.current
    ) {
      callWasReady.current = false;
      onAgentLeft();
    }
  });

  const renewTokens = useCallback(async () => {
    if (!client.uid) return;
    try {
      const token = await onTokenWillExpire();
      await Promise.all([
        client.renewToken(token),
        rtmClient?.renewToken(token) ?? Promise.resolve(),
      ]);
    } catch (error) {
      onRuntimeError(
        error instanceof Error ? error.message : 'Agora token renewal failed.',
      );
    }
  }, [client, onRuntimeError, onTokenWillExpire, rtmClient]);

  useClientEvent(client, 'token-privilege-will-expire', renewTokens);

  useClientEvent(client, 'connection-state-change', (state) => {
    if (state === 'DISCONNECTED' && callWasReady.current) {
      onRuntimeError('The Agora RTC connection was interrupted.');
    }
  });

  return (
    <div className="agora-remote-audio" aria-hidden="true">
      {remoteUsers.map((user) => (
        <RemoteUser key={user.uid} user={user} />
      ))}
    </div>
  );
}
