import { NextRequest, NextResponse } from 'next/server';
import AgoraToken from 'agora-token';

const { RtcRole, RtcTokenBuilder } = AgoraToken;

const TOKEN_EXPIRATION_SECONDS = 10 * 60;

function generateChannelName() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `rotary-ai-${timestamp}-${random}`;
}

function isSafeChannel(value: string) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export async function GET(request: NextRequest) {
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  const appCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;

  if (!appId || !appCertificate) {
    return NextResponse.json(
      { error: 'Agora credentials are not configured.' },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const requestedChannel = searchParams.get('channel');
  if (requestedChannel && !isSafeChannel(requestedChannel)) {
    return NextResponse.json({ error: 'Invalid channel.' }, { status: 400 });
  }

  const uidParam = searchParams.get('uid');
  const parsedUid = uidParam ? Number.parseInt(uidParam, 10) : Number.NaN;
  const uid = Number.isInteger(parsedUid) && parsedUid > 0
    ? parsedUid
    : Math.floor(Math.random() * 9_999_000) + 1000;
  const channel = requestedChannel ?? generateChannelName();
  const expiration = Math.floor(Date.now() / 1000) + TOKEN_EXPIRATION_SECONDS;

  try {
    const token = RtcTokenBuilder.buildTokenWithRtm(
      appId,
      appCertificate,
      channel,
      String(uid),
      RtcRole.PUBLISHER,
      expiration,
      expiration,
    );

    return NextResponse.json({ token, uid: String(uid), channel });
  } catch (error) {
    console.error('Failed to generate Agora token:', error);
    return NextResponse.json(
      { error: 'Failed to generate Agora token.' },
      { status: 500 },
    );
  }
}
