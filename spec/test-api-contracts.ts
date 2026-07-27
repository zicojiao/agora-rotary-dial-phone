import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET as generateToken } from '../app/api/generate-agora-token/route';
import { POST as inviteAgent } from '../app/api/invite-agent/route';
import {
  FISH_AUDIO_BACKEND,
  FISH_AUDIO_REFERENCE_ID,
  createFishAudioTts,
} from '../lib/fishAudio';
import { POST as stopConversation } from '../app/api/stop-conversation/route';

const originalAppId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
const originalCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
const originalFishAudioKey = process.env.FISH_AUDIO_API_KEY;

async function main() {
  try {
    delete process.env.NEXT_PUBLIC_AGORA_APP_ID;
    delete process.env.NEXT_AGORA_APP_CERTIFICATE;

    const missingCredentials = await generateToken(
      new NextRequest('http://localhost/api/generate-agora-token'),
    );
    assert.equal(missingCredentials.status, 500);
    assert.deepEqual(await missingCredentials.json(), {
      error: 'Agora credentials are not configured.',
    });

    process.env.NEXT_PUBLIC_AGORA_APP_ID = '0'.repeat(32);
    process.env.NEXT_AGORA_APP_CERTIFICATE = '1'.repeat(32);

    const invalidChannel = await generateToken(
      new NextRequest(
        'http://localhost/api/generate-agora-token?channel=not%20safe',
      ),
    );
    assert.equal(invalidChannel.status, 400);

    const tokenResponse = await generateToken(
      new NextRequest(
        'http://localhost/api/generate-agora-token?channel=rotary_test&uid=42',
      ),
    );
    assert.equal(tokenResponse.status, 200);
    const tokenPayload = (await tokenResponse.json()) as Record<string, unknown>;
    assert.equal(tokenPayload.uid, '42');
    assert.equal(tokenPayload.channel, 'rotary_test');
    assert.equal(typeof tokenPayload.token, 'string');
    assert.ok(String(tokenPayload.token).length > 40);
    assert.equal('appCertificate' in tokenPayload, false);
    assert.equal('certificate' in tokenPayload, false);

    const invalidInvite = await inviteAgent(
      new NextRequest('http://localhost/api/invite-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_id: 42,
          channel_name: 'rotary_test',
        }),
      }),
    );
    assert.equal(invalidInvite.status, 400);

    const unsafeInvite = await inviteAgent(
      new NextRequest('http://localhost/api/invite-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_id: '42',
          channel_name: '../rotary_test',
        }),
      }),
    );
    assert.equal(unsafeInvite.status, 400);

    delete process.env.FISH_AUDIO_API_KEY;
    const missingFishCredentials = await inviteAgent(
      new NextRequest('http://localhost/api/invite-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_id: '42',
          channel_name: 'rotary_test',
        }),
      }),
    );
    assert.equal(missingFishCredentials.status, 500);
    assert.deepEqual(await missingFishCredentials.json(), {
      error: 'Missing required environment variable: FISH_AUDIO_API_KEY',
    });

    process.env.FISH_AUDIO_API_KEY = 'fish-test-key';
    assert.deepEqual(createFishAudioTts().toConfig(), {
      vendor: 'fishaudio',
      params: {
        api_key: 'fish-test-key',
        reference_id: FISH_AUDIO_REFERENCE_ID,
        backend: FISH_AUDIO_BACKEND,
      },
    });
    assert.equal(FISH_AUDIO_REFERENCE_ID, '498f6b2cb8104c4583690d1dffefa8bb');
    assert.equal(FISH_AUDIO_BACKEND, 's2.1-pro');

    const invalidStop = await stopConversation(
      new Request('http://localhost/api/stop-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: '' }),
      }),
    );
    assert.equal(invalidStop.status, 400);

    console.log('Agora API contract checks passed.');
  } finally {
    if (originalAppId === undefined) {
      delete process.env.NEXT_PUBLIC_AGORA_APP_ID;
    } else {
      process.env.NEXT_PUBLIC_AGORA_APP_ID = originalAppId;
    }
    if (originalCertificate === undefined) {
      delete process.env.NEXT_AGORA_APP_CERTIFICATE;
    } else {
      process.env.NEXT_AGORA_APP_CERTIFICATE = originalCertificate;
    }
    if (originalFishAudioKey === undefined) {
      delete process.env.FISH_AUDIO_API_KEY;
    } else {
      process.env.FISH_AUDIO_API_KEY = originalFishAudioKey;
    }
  }
}

void main();
