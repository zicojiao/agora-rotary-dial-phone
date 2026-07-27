import { NextResponse } from 'next/server';
import { AgoraClient, Area } from 'agora-agents';
import type { StopConversationRequest } from '@/types/conversation';

function isAlreadyStopped(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    statusCode?: number;
    body?: { detail?: string; reason?: string };
    message?: string;
  };
  const detail = (
    candidate.body?.detail ??
    candidate.message ??
    ''
  ).toLowerCase();
  return (
    candidate.statusCode === 404 ||
    (
      candidate.body?.reason?.toLowerCase() === 'invalidrequest' &&
      detail.includes('already in the process of shutting down')
    )
  );
}

function isValidStopRequest(value: unknown): value is StopConversationRequest {
  if (!value || typeof value !== 'object') return false;
  const agentId = (value as Partial<StopConversationRequest>).agent_id;
  return typeof agentId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(agentId);
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isValidStopRequest(body)) {
      return NextResponse.json(
        { error: 'A valid agent_id is required.' },
        { status: 400 },
      );
    }

    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
    const appCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
    if (!appId || !appCertificate) {
      throw new Error('Agora credentials are not configured.');
    }

    const client = new AgoraClient({
      area: Area.US,
      appId,
      appCertificate,
    });

    try {
      await client.stopAgent(body.agent_id);
    } catch (error) {
      if (isAlreadyStopped(error)) {
        return NextResponse.json({
          success: true,
          state: 'already-stopping',
        });
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to stop Agora agent:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to stop the Agora agent.',
      },
      { status: 500 },
    );
  }
}
