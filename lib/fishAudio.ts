import { FishAudioTTS } from 'agora-agents';

export const FISH_AUDIO_REFERENCE_ID =
  '498f6b2cb8104c4583690d1dffefa8bb';
export const FISH_AUDIO_BACKEND = 's2.1-pro';

export function createFishAudioTts(
  key = process.env.FISH_AUDIO_API_KEY,
) {
  if (!key) {
    throw new Error(
      'Missing required environment variable: FISH_AUDIO_API_KEY',
    );
  }
  return new FishAudioTTS({
    key,
    referenceId: FISH_AUDIO_REFERENCE_ID,
    backend: FISH_AUDIO_BACKEND,
  });
}
