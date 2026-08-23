/**
 * Voice feature detection.
 *
 * vitest runs in a node environment here (no jsdom), so `window` is absent —
 * which is exactly the "browser without speech support" path the panel has to
 * degrade through. Everything must report unsupported rather than throw.
 */

import { describe, it, expect } from 'vitest';
import {
  cancelSpeech, createRecognizer, speak, speechSupported, speechSynthesisSupported,
} from './commanderVoice';

describe('feature detection without a browser', () => {
  it('reports speech recognition unsupported', () => {
    expect(speechSupported()).toBe(false);
  });

  it('reports speech synthesis unsupported', () => {
    expect(speechSynthesisSupported()).toBe(false);
  });

  it('returns an inert recognizer rather than throwing', () => {
    const rec = createRecognizer({
      onInterim: () => {}, onFinal: () => {}, onError: () => {},
    });
    expect(rec.supported).toBe(false);
    expect(() => { rec.start(); rec.stop(); rec.abort(); }).not.toThrow();
  });

  it('makes speak/cancelSpeech no-ops', () => {
    expect(() => { speak('Copy, weapons hold.'); cancelSpeech(); }).not.toThrow();
  });
});
