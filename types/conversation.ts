import type { RTMClient } from 'agora-rtm';

export interface AgoraTokenData {
  token: string;
  uid: string;
  channel: string;
  agentId: string;
}

export interface ClientStartRequest {
  requester_id: string;
  channel_name: string;
}

export interface StopConversationRequest {
  agent_id: string;
}

export interface AgentResponse {
  agent_id: string;
  create_ts: number;
  state: string;
}

export interface AgoraRenewalTokens {
  rtcToken: string;
  rtmToken: string;
}

export type MicrophoneRuntimeState =
  | 'requesting'
  | 'publishing'
  | 'ready';

export interface AgoraRuntimeProps {
  agoraData: AgoraTokenData;
  rtmClient: RTMClient;
  onConnected: () => void;
  onAgentLeft: () => void;
  onMicrophoneState: (state: MicrophoneRuntimeState) => void;
  onRuntimeError: (message: string) => void;
  onTokenWillExpire: (uid: string) => Promise<AgoraRenewalTokens>;
}
