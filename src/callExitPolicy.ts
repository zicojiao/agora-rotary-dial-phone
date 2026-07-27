import type { CallPhase } from '@/src/callPolicy';

export interface PageExitTransport {
  sendBeacon: (url: string, data?: BodyInit | null) => boolean;
  fetch: typeof fetch;
}

export function shouldConfirmCallExit(
  phase: CallPhase,
  hasActiveSession: boolean,
) {
  return (
    hasActiveSession ||
    phase === 'connecting' ||
    phase === 'connected' ||
    phase === 'ending'
  );
}

export function requestAgentStopOnPageExit(
  agentId: string,
  transport: PageExitTransport,
) {
  const body = JSON.stringify({ agent_id: agentId });
  if (transport.sendBeacon('/api/stop-conversation', body)) {
    return 'beacon' as const;
  }

  void transport.fetch('/api/stop-conversation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // The browser is already leaving; the server also handles request aborts.
  });
  return 'fetch' as const;
}
