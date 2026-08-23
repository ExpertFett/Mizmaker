/**
 * Voice in and out for the Commander, on browser built-ins only.
 *
 * Speech-to-text is the Web Speech API: no key, no backend, and interim results
 * so the GM sees words appear as they speak. It's Chrome/Edge-only, which is
 * the same platform promise the SRS voice button already makes, so this adds no
 * new constraint. Everything degrades to the text box when it's absent.
 *
 * Push-to-talk rather than an open mic, deliberately: a GM is on comms with
 * real people, and an open mic would ship half the squadron's chatter to the
 * model. Mirrors SrsRadioPanel's hold-to-talk + hotkey pattern.
 */

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function speechSupported(): boolean {
  return getCtor() !== null;
}

export interface RecognizerHandlers {
  /** Fires repeatedly while speaking — render this as provisional text. */
  onInterim: (text: string) => void;
  /** Fires once when the mic is released with a usable transcript. */
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

export interface Recognizer {
  supported: boolean;
  start: () => void;
  /** Stop listening and deliver whatever was captured. */
  stop: () => void;
  /** Drop the session without delivering (used on unmount / cancel). */
  abort: () => void;
}

const NO_OP: Recognizer = {
  supported: false, start: () => {}, stop: () => {}, abort: () => {},
};

/**
 * A push-to-talk wrapper. Transcript fragments accumulate across the hold and
 * are delivered once on release — Chrome fires `onend` on its own after a pause
 * in speech, so we can't rely on that as the release signal.
 */
export function createRecognizer(handlers: RecognizerHandlers, lang = 'en-US'): Recognizer {
  const Ctor = getCtor();
  if (!Ctor) return NO_OP;

  let rec: SpeechRecognitionLike | null = null;
  let finalText = '';
  let listening = false;

  const teardown = () => {
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    rec = null;
  };

  return {
    supported: true,

    start() {
      if (listening) return;
      listening = true;
      finalText = '';
      try {
        rec = new Ctor();
      } catch {
        listening = false;
        handlers.onError('Could not start speech recognition.');
        return;
      }
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = lang;

      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const chunk = r[0]?.transcript || '';
          if (r.isFinal) finalText += chunk; else interim += chunk;
        }
        handlers.onInterim((finalText + interim).trim());
      };

      rec.onerror = (e) => {
        const code = e?.error || 'unknown';
        // 'aborted' is us calling abort(); 'no-speech' just means a quiet hold.
        if (code !== 'aborted' && code !== 'no-speech') {
          handlers.onError(
            code === 'not-allowed'
              ? 'Microphone permission denied.'
              : `Speech recognition error: ${code}`,
          );
        }
      };

      // Chrome ends the session on its own after silence. Restart while the key
      // is still held so a pause mid-order doesn't cut the transmission short.
      rec.onend = () => {
        if (listening && rec) {
          try { rec.start(); } catch { /* already restarting */ }
        }
      };

      try {
        rec.start();
      } catch {
        listening = false;
        teardown();
        handlers.onError('Microphone is unavailable.');
      }
    },

    stop() {
      if (!listening) return;
      listening = false;
      try { rec?.stop(); } catch { /* already stopped */ }
      teardown();
      const text = finalText.trim();
      finalText = '';
      if (text) handlers.onFinal(text);
    },

    abort() {
      listening = false;
      try { rec?.abort(); } catch { /* already gone */ }
      teardown();
      finalText = '';
    },
  };
}

// ─── Talkback ──────────────────────────────────────────────────────────────

export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Speak the Commander's reply. Never used for tool-result noise. */
export function speak(text: string): void {
  if (!speechSynthesisSupported()) return;
  const clean = text.trim();
  if (!clean) return;
  try {
    window.speechSynthesis.cancel();   // interrupt whatever is mid-sentence
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 1.05;   // slightly quick — this is meant to sound like radio
    window.speechSynthesis.speak(u);
  } catch { /* speech is a nicety; never let it break the panel */ }
}

export function cancelSpeech(): void {
  if (!speechSynthesisSupported()) return;
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
}
