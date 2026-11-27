import type { GateState } from '../../shared/levels';

export type ClackAudioController = {
  readonly isMuted: () => boolean;
  readonly setMuted: (muted: boolean) => void;
  readonly toggleMute: () => boolean;
  readonly unlock: () => void;
  readonly dispose: () => void;
  readonly playClack: (toState: GateState) => void;
  readonly playGatePass: () => void;
  readonly playLaunch: () => void;
  readonly playKey: (keyCount: number) => void;
  readonly playSpring: () => void;
  readonly playTrapdoor: () => void;
  readonly playLockedBell: () => void;
  readonly playVictoryBell: () => void;
};

const LOOKAHEAD_SEC = 0.004;

function getAudioContextConstructor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  if (typeof window.AudioContext === 'function') {
    return window.AudioContext;
  }
  const maybeWebkit = Reflect.get(window, 'webkitAudioContext');
  if (typeof maybeWebkit === 'function') {
    return maybeWebkit;
  }
  return null;
}

export function createClackAudio(): ClackAudioController {
  let ctx: AudioContext | null = null;
  let disposed = false;
  let muted = false;
  let primed = false;
  // Deterministic noise PRNG for wooden transient burst
  let noiseSeed = 0x517cc1b7;

  const nextNoise = (): number => {
    noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
    return (noiseSeed / 4294967296) * 2 - 1;
  };

  const primeHardwareOutput = (audioCtx: AudioContext): void => {
    if (primed) return;
    primed = true;
    try {
      const silentBuf = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
      const src = audioCtx.createBufferSource();
      src.buffer = silentBuf;
      src.connect(audioCtx.destination);
      src.start(0);
    } catch {
      // Ignore if audio graph is not ready yet
    }
  };

  const ensureContext = (): AudioContext | null => {
    if (muted || disposed) return null;
    if (!ctx) {
      const Ctor = getAudioContextConstructor();
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') {
      void ctx
        .resume()
        .then(() => {
          if (ctx && ctx.state === 'running') {
            primeHardwareOutput(ctx);
          }
        })
        .catch(() => {});
    } else if (ctx.state === 'running') {
      primeHardwareOutput(ctx);
    }
    return ctx;
  };

  const withRunningContext = (playFn: (audioCtx: AudioContext, startAt: number) => void): void => {
    const audioCtx = ensureContext();
    if (!audioCtx) return;

    if (audioCtx.state === 'running') {
      playFn(audioCtx, audioCtx.currentTime + LOOKAHEAD_SEC);
      return;
    }

    // If AudioContext is still resuming from suspended state, schedule right when it becomes running
    void audioCtx
      .resume()
      .then(() => {
        if (!disposed && !muted && audioCtx.state === 'running') {
          primeHardwareOutput(audioCtx);
          playFn(audioCtx, audioCtx.currentTime + LOOKAHEAD_SEC);
        }
      })
      .catch(() => {});
  };

  const unlock = (): void => {
    ensureContext();
  };

  const playClack = (toState: GateState): void => {
    withRunningContext((audioCtx, now) => {
      // Crisp wooden snap body impulse
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      const baseFreq = toState === 'A' ? 320 : 385;
      osc.frequency.setValueAtTime(baseFreq * 1.55, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.55, now + 0.065);
      gain.gain.setValueAtTime(0.36, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.09);

      // Secondary woody knock overtone for crisp laptop/mobile audibility
      const knock = audioCtx.createOscillator();
      const kgain = audioCtx.createGain();
      knock.type = 'sine';
      knock.frequency.setValueAtTime(baseFreq * 2.6, now);
      knock.frequency.exponentialRampToValueAtTime(baseFreq * 1.1, now + 0.035);
      kgain.gain.setValueAtTime(0.2, now);
      kgain.gain.exponentialRampToValueAtTime(0.001, now + 0.042);
      knock.connect(kgain);
      kgain.connect(audioCtx.destination);
      knock.start(now);
      knock.stop(now + 0.048);

      // Short filtered noise click transient
      const len = Math.max(1, Math.floor(audioCtx.sampleRate * 0.036));
      const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = nextNoise() * Math.exp(-i / (len * 0.35));
      }
      const noise = audioCtx.createBufferSource();
      noise.buffer = buf;
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = toState === 'A' ? 1450 : 1850;
      filter.Q.value = 1.8;
      const ngain = audioCtx.createGain();
      ngain.gain.setValueAtTime(0.34, now);
      ngain.gain.exponentialRampToValueAtTime(0.001, now + 0.036);
      noise.connect(filter);
      filter.connect(ngain);
      ngain.connect(audioCtx.destination);
      noise.start(now);
      noise.stop(now + 0.04);
    });
  };

  const playGatePass = (): void => {
    withRunningContext((audioCtx, now) => {
      // Soft tactile brass-on-wood deflection tick as marble rolls cleanly across a gate turntable
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(310, now + 0.036);
      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.044);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.048);

      const len = Math.max(1, Math.floor(audioCtx.sampleRate * 0.018));
      const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = nextNoise() * Math.exp(-i / (len * 0.3));
      }
      const noise = audioCtx.createBufferSource();
      noise.buffer = buf;
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2100;
      filter.Q.value = 2.2;
      const ngain = audioCtx.createGain();
      ngain.gain.setValueAtTime(0.09, now);
      ngain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);
      noise.connect(filter);
      filter.connect(ngain);
      ngain.connect(audioCtx.destination);
      noise.start(now);
      noise.stop(now + 0.02);
    });
  };

  const playLaunch = (): void => {
    withRunningContext((audioCtx, now) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(420, now + 0.09);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.13);
    });
  };

  const playKey = (keyCount: number): void => {
    withRunningContext((audioCtx, now) => {
      const notes = [523.25, 659.25, 783.99] as const; // C5, E5, G5
      const idx = Math.min(2, Math.max(0, keyCount - 1));
      const freq = notes[idx] ?? 523.25;

      const partials = [1, 2.0, 3.01] as const;
      partials.forEach((mult, partialIdx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = partialIdx === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq * mult, now);
        const amp = partialIdx === 0 ? 0.18 : partialIdx === 1 ? 0.06 : 0.025;
        gain.gain.setValueAtTime(amp, now);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.42 - partialIdx * 0.08);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.45);
      });
    });
  };

  const playSpring = (): void => {
    withRunningContext((audioCtx, now) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.16);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    });
  };

  const playTrapdoor = (): void => {
    withRunningContext((audioCtx, now) => {
      // 1. Crisp iron-grate latch click + short metallic clink as trapdoor swings open
      const clickLen = Math.max(1, Math.floor(audioCtx.sampleRate * 0.032));
      const clickBuf = audioCtx.createBuffer(1, clickLen, audioCtx.sampleRate);
      const clickData = clickBuf.getChannelData(0);
      for (let i = 0; i < clickLen; i++) {
        clickData[i] = nextNoise() * Math.exp(-i / (clickLen * 0.28));
      }
      const click = audioCtx.createBufferSource();
      click.buffer = clickBuf;
      const clickFilter = audioCtx.createBiquadFilter();
      clickFilter.type = 'bandpass';
      clickFilter.frequency.value = 1250;
      clickFilter.Q.value = 2.1;
      const clickGain = audioCtx.createGain();
      clickGain.gain.setValueAtTime(0.28, now);
      clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
      click.connect(clickFilter);
      clickFilter.connect(clickGain);
      clickGain.connect(audioCtx.destination);
      click.start(now);
      click.stop(now + 0.038);

      // 2. Smooth falling brass-marble pitch glide (warm descending whistle into the pit)
      const fallStart = now + 0.025;
      const fallOsc = audioCtx.createOscillator();
      const fallSub = audioCtx.createOscillator();
      const fallGain = audioCtx.createGain();
      const subGain = audioCtx.createGain();
      fallOsc.type = 'sine';
      fallSub.type = 'triangle';
      fallOsc.frequency.setValueAtTime(620, fallStart);
      fallOsc.frequency.exponentialRampToValueAtTime(118, fallStart + 0.52);
      fallSub.frequency.setValueAtTime(310, fallStart);
      fallSub.frequency.exponentialRampToValueAtTime(68, fallStart + 0.52);

      fallGain.gain.setValueAtTime(0.001, fallStart);
      fallGain.gain.linearRampToValueAtTime(0.38, fallStart + 0.035);
      fallGain.gain.linearRampToValueAtTime(0.31, fallStart + 0.25);
      fallGain.gain.exponentialRampToValueAtTime(0.001, fallStart + 0.56);

      subGain.gain.value = 0.52;
      fallOsc.connect(fallGain);
      fallSub.connect(subGain);
      subGain.connect(fallGain);
      fallGain.connect(audioCtx.destination);
      fallOsc.start(fallStart);
      fallSub.start(fallStart);
      fallOsc.stop(fallStart + 0.58);
      fallSub.stop(fallStart + 0.58);

      // 3. Very subtle downward air breath (kept quiet so the clean glide stands out)
      const whooshLen = Math.max(1, Math.floor(audioCtx.sampleRate * 0.44));
      const whooshBuf = audioCtx.createBuffer(1, whooshLen, audioCtx.sampleRate);
      const whooshData = whooshBuf.getChannelData(0);
      for (let i = 0; i < whooshLen; i++) {
        whooshData[i] = nextNoise();
      }
      const whoosh = audioCtx.createBufferSource();
      whoosh.buffer = whooshBuf;
      const whooshFilter = audioCtx.createBiquadFilter();
      whooshFilter.type = 'bandpass';
      whooshFilter.Q.value = 1.8;
      whooshFilter.frequency.setValueAtTime(920, fallStart);
      whooshFilter.frequency.exponentialRampToValueAtTime(220, fallStart + 0.42);
      const whooshGain = audioCtx.createGain();
      whooshGain.gain.setValueAtTime(0.001, fallStart);
      whooshGain.gain.linearRampToValueAtTime(0.06, fallStart + 0.05);
      whooshGain.gain.exponentialRampToValueAtTime(0.001, fallStart + 0.44);
      whoosh.connect(whooshFilter);
      whooshFilter.connect(whooshGain);
      whooshGain.connect(audioCtx.destination);
      whoosh.start(fallStart);
      whoosh.stop(fallStart + 0.45);

      // 4. Punchy hollow woody landing thud at the bottom of the pit
      const thudAt = now + 0.55;
      const thud = audioCtx.createOscillator();
      const thudGain = audioCtx.createGain();
      thud.type = 'triangle';
      thud.frequency.setValueAtTime(175, thudAt);
      thud.frequency.exponentialRampToValueAtTime(60, thudAt + 0.15);
      thudGain.gain.setValueAtTime(0.34, thudAt);
      thudGain.gain.exponentialRampToValueAtTime(0.001, thudAt + 0.18);
      thud.connect(thudGain);
      thudGain.connect(audioCtx.destination);
      thud.start(thudAt);
      thud.stop(thudAt + 0.19);

      // Brief dull brass-on-wood bounce knock so the landing thud reads clearly on laptop/phone speakers
      const knock = audioCtx.createOscillator();
      const knockGain = audioCtx.createGain();
      knock.type = 'sine';
      knock.frequency.setValueAtTime(340, thudAt);
      knock.frequency.exponentialRampToValueAtTime(145, thudAt + 0.065);
      knockGain.gain.setValueAtTime(0.18, thudAt);
      knockGain.gain.exponentialRampToValueAtTime(0.001, thudAt + 0.075);
      knock.connect(knockGain);
      knockGain.connect(audioCtx.destination);
      knock.start(thudAt);
      knock.stop(thudAt + 0.08);
    });
  };

  const playLockedBell = (): void => {
    withRunningContext((audioCtx, now) => {
      // Muffled brass double-clunk ("uh-uh" descending minor drop — bell refuses to ring)
      const hits = [
        { offset: 0, base: 330, ratio: 1.37, amp: 0.28 },
        { offset: 0.135, base: 247, ratio: 1.39, amp: 0.3 },
      ] as const;

      for (const hit of hits) {
        const t = now + hit.offset;

        // Damped metallic bell body (slightly detuned inharmonic pair, cut short)
        const body = audioCtx.createOscillator();
        const clank = audioCtx.createOscillator();
        const filter = audioCtx.createBiquadFilter();
        const gain = audioCtx.createGain();

        body.type = 'triangle';
        clank.type = 'square';
        body.frequency.setValueAtTime(hit.base, t);
        body.frequency.exponentialRampToValueAtTime(hit.base * 0.88, t + 0.11);
        clank.frequency.setValueAtTime(hit.base * hit.ratio, t);
        clank.frequency.exponentialRampToValueAtTime(hit.base * hit.ratio * 0.9, t + 0.08);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1150, t);
        filter.frequency.exponentialRampToValueAtTime(340, t + 0.12);

        gain.gain.setValueAtTime(hit.amp, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

        const clankGain = audioCtx.createGain();
        clankGain.gain.value = 0.28;

        body.connect(filter);
        clank.connect(clankGain);
        clankGain.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);

        body.start(t);
        clank.start(t);
        body.stop(t + 0.15);
        clank.stop(t + 0.15);

        // Short damped padlock/brass rattle transient
        const len = Math.max(1, Math.floor(audioCtx.sampleRate * 0.024));
        const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          data[i] = nextNoise() * Math.exp(-i / (len * 0.3));
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buf;
        const nFilter = audioCtx.createBiquadFilter();
        nFilter.type = 'bandpass';
        nFilter.frequency.value = hit.base * 3.4;
        nFilter.Q.value = 2.4;
        const nGain = audioCtx.createGain();
        nGain.gain.setValueAtTime(0.22, t);
        nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.024);
        noise.connect(nFilter);
        nFilter.connect(nGain);
        nGain.connect(audioCtx.destination);
        noise.start(t);
        noise.stop(t + 0.028);
      }
    });
  };

  const playVictoryBell = (): void => {
    withRunningContext((audioCtx, now) => {
      // Warm brass bell harmonic chord (C5, E5, G5, C6)
      const freqs = [523.25, 659.25, 783.99, 1046.5] as const;
      freqs.forEach((f, idx) => {
        const t = now + idx * 0.055;
        const osc = audioCtx.createOscillator();
        const over = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        over.type = 'triangle';
        osc.frequency.setValueAtTime(f, t);
        over.frequency.setValueAtTime(f * 2.004, t);
        gain.gain.setValueAtTime(0.14, t);
        gain.gain.exponentialRampToValueAtTime(0.0008, t + 1.35);
        osc.connect(gain);
        const og = audioCtx.createGain();
        og.gain.value = 0.25;
        over.connect(og);
        og.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        over.start(t);
        osc.stop(t + 1.4);
        over.stop(t + 1.4);
      });
    });
  };

  const setMuted = (m: boolean): void => {
    muted = m;
  };

  return {
    isMuted: () => muted,
    setMuted,
    toggleMute: () => {
      setMuted(!muted);
      return muted;
    },
    unlock,
    dispose: () => {
      disposed = true;
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
      ctx = null;
    },
    playClack,
    playGatePass,
    playLaunch,
    playKey,
    playSpring,
    playTrapdoor,
    playLockedBell,
    playVictoryBell,
  };
}
