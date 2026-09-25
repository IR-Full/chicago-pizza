'use client';

import { useCallback, useEffect, useRef } from 'react';

/** Two short notes, high enough to carry over an extractor fan. */
const NOTES = [880, 1174];
const NOTE_SECONDS = 0.12;

/**
 * Sounds when a new order lands on the kitchen screen.
 *
 * Synthesised rather than shipped as a file: two sine notes need no asset, no
 * cache entry and no decision about which formats to encode, and a kitchen
 * screen needs a sound that cuts through an extractor fan more than it needs a
 * designed one.
 *
 * The context is created on the first ring, not on mount: browsers refuse to
 * start audio before a gesture, and one built too early sits in a suspended
 * state that never recovers.
 */
export function useNewOrderChime(enabled: boolean) {
  const context = useRef<AudioContext | null>(null);

  useEffect(
    () => () => {
      void context.current?.close();
      context.current = null;
    },
    [],
  );

  return useCallback(() => {
    if (!enabled) return;

    try {
      const AudioContextClass =
        window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      context.current ??= new AudioContextClass();
      const audio = context.current;
      // A tab left in the background suspends the context; a new order is
      // exactly when it needs waking.
      if (audio.state === 'suspended') void audio.resume();

      NOTES.forEach((frequency, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const startAt = audio.currentTime + index * NOTE_SECONDS;

        oscillator.frequency.value = frequency;
        // Ramped, not switched: a square edge on a gain node clicks.
        gain.gain.setValueAtTime(0, startAt);
        gain.gain.linearRampToValueAtTime(0.25, startAt + 0.01);
        gain.gain.linearRampToValueAtTime(0, startAt + NOTE_SECONDS);

        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + NOTE_SECONDS);
      });
    } catch {
      // No audio is a missing convenience, not a broken screen.
    }
  }, [enabled]);
}
