function isAppleMobileBrowser() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function createDialToneDataUrl() {
  const sampleRate = 22050;
  const sampleCount = sampleRate;
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, sampleCount * 2, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const sample = (
      Math.sin(Math.PI * 2 * 350 * time)
      + Math.sin(Math.PI * 2 * 440 * time)
    ) * 0.2;
    view.setInt16(44 + index * 2, Math.round(sample * 32767), true);
  }

  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export class PhoneAudio {
  private context: AudioContext | null = null;
  private output: {
    master: DynamicsCompressorNode;
    line: GainNode;
    mechanical: GainNode;
  } | null = null;
  private resumePromise: Promise<void> | null = null;
  private dialTone: { oscillators: OscillatorNode[]; gain: GainNode } | null = null;
  private dialToneElement: HTMLAudioElement | null = null;
  private dialToneElementPlaying = false;
  private _enabled = true;

  constructor() {
    if (!isAppleMobileBrowser()) return;
    this.dialToneElement = new Audio(createDialToneDataUrl());
    this.dialToneElement.loop = true;
    this.dialToneElement.preload = 'auto';
    this.dialToneElement.volume = 0.36;
    this.dialToneElement.setAttribute('playsinline', '');
  }

  get enabled() {
    return this._enabled;
  }

  get route() {
    return this.dialToneElement ? 'native-media' : 'web-audio';
  }

  get lineActive() {
    return this.dialToneElementPlaying || Boolean(this.dialTone);
  }

  setEnabled(enabled: boolean) {
    this._enabled = enabled;
    if (!enabled) this.stopDialTone();
  }

  unlock() {
    if (!this._enabled) return Promise.resolve(null);
    const context = this.ensureContext();
    const wakeBuffer = context.createBuffer(1, 1, context.sampleRate);
    const wakeSource = context.createBufferSource();
    wakeSource.buffer = wakeBuffer;
    wakeSource.connect(this.bus('line'));
    wakeSource.start(0);
    return this.resume(context);
  }

  private ensureContext() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      const master = this.context.createDynamicsCompressor();
      master.threshold.value = -18;
      master.knee.value = 10;
      master.ratio.value = 3.5;
      master.attack.value = 0.003;
      master.release.value = 0.11;

      const line = this.context.createGain();
      const mechanical = this.context.createGain();
      line.gain.value = 1;
      mechanical.gain.value = 1;
      line.connect(master);
      mechanical.connect(master);
      master.connect(this.context.destination);
      this.output = { master, line, mechanical };
    }
    return this.context;
  }

  private async resume(context: AudioContext) {
    const state = context.state as string;
    if (state !== 'running' && state !== 'closed') {
      if (!this.resumePromise) {
        this.resumePromise = context.resume()
          .catch(() => undefined)
          .finally(() => {
            this.resumePromise = null;
          });
      }
      await this.resumePromise;
    }
    return context;
  }

  private activate() {
    return this.resume(this.ensureContext());
  }

  private bus(kind: 'line' | 'mechanical') {
    if (!this.output) throw new Error('Audio output is not initialized.');
    return this.output[kind];
  }

  async startDialTone() {
    if (!this._enabled || this.dialTone || this.dialToneElementPlaying) return;
    if (this.dialToneElement) {
      this.dialToneElementPlaying = true;
      try {
        await this.dialToneElement.play();
      } catch {
        this.dialToneElementPlaying = false;
      }
      return;
    }
    const context = await this.activate();
    if (!this._enabled || this.dialTone) return;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.052, context.currentTime + 0.16);
    gain.connect(this.bus('line'));

    const oscillators = [350, 440].map((frequency) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start();
      return oscillator;
    });
    this.dialTone = { oscillators, gain };
  }

  stopDialTone() {
    if (this.dialToneElement) {
      this.dialToneElement.pause();
      this.dialToneElement.currentTime = 0;
      this.dialToneElementPlaying = false;
    }
    if (!this.context || !this.dialTone) return;
    const { oscillators, gain } = this.dialTone;
    const now = this.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0.0001, now, 0.025);
    oscillators.forEach((oscillator) => oscillator.stop(now + 0.12));
    this.dialTone = null;
  }

  async playHookClick(lifted: boolean) {
    if (!this._enabled) return;
    const context = await this.activate();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(lifted ? 128 : 94, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(42, context.currentTime + 0.09);
    gain.gain.setValueAtTime(0.105, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.11);
    oscillator.connect(gain).connect(this.bus('line'));
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
  }

  private async playNoiseClick(
    strength: number,
    frequency: number,
    duration: number,
  ) {
    if (!this._enabled) return;
    const context = await this.activate();
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      const envelope = 1 - index / channel.length;
      channel[index] = (Math.random() * 2 - 1) * envelope * envelope;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 1.35;
    gain.gain.value = strength;
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(this.bus('mechanical'));
    source.start();
  }

  private async playMetallicRatchet(notch: number) {
    if (!this._enabled) return;
    const context = await this.activate();
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const now = context.currentTime;

    oscillator.type = notch % 2 === 0 ? 'triangle' : 'square';
    oscillator.frequency.setValueAtTime(1480 + (notch % 4) * 110, now);
    oscillator.frequency.exponentialRampToValueAtTime(620, now + 0.024);
    filter.type = 'bandpass';
    filter.frequency.value = 1700;
    filter.Q.value = 2.4;
    gain.gain.setValueAtTime(0.032, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.026);
    oscillator.connect(filter).connect(gain).connect(this.bus('mechanical'));
    oscillator.start(now);
    oscillator.stop(now + 0.028);
  }

  async playDialWindTick(notch: number) {
    const alternate = notch % 2 === 0 ? 1 : 0.86;
    await Promise.all([
      this.playNoiseClick(0.105 * alternate, 2850 + (notch % 3) * 160, 0.018),
      this.playMetallicRatchet(notch),
    ]);
  }

  playDialTick(strength = 1) {
    return this.playNoiseClick(0.118 * strength, 1750, 0.03);
  }

  async playDialRelease() {
    if (!this._enabled) return;
    const context = await this.activate();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(72, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(38, context.currentTime + 0.16);
    gain.gain.setValueAtTime(0.062, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.connect(gain).connect(this.bus('mechanical'));
    oscillator.start();
    oscillator.stop(context.currentTime + 0.19);
  }

  async playDialStop() {
    if (!this._enabled) return;
    const context = await this.activate();
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(920, now);
    oscillator.frequency.exponentialRampToValueAtTime(310, now + 0.045);
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    filter.Q.value = 1.8;
    gain.gain.setValueAtTime(0.085, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.052);
    oscillator.connect(filter).connect(gain).connect(this.bus('mechanical'));
    oscillator.start(now);
    oscillator.stop(now + 0.055);

    await this.playNoiseClick(0.13, 1350, 0.038);
  }

  dispose() {
    this.stopDialTone();
    if (this.dialToneElement) {
      this.dialToneElement.removeAttribute('src');
      this.dialToneElement.load();
      this.dialToneElement = null;
    }
    void this.context?.close();
    this.context = null;
    this.output = null;
    this.resumePromise = null;
  }
}
