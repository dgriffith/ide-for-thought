/**
 * Voice/dictation preferences (#voice).
 *
 * These are renderer-local UI prefs — which Whisper model to run and whether
 * the mic affordance is shown — so they live in `localStorage` rather than the
 * main-process `llm-settings.json` (which holds the Anthropic key/model the
 * conversation runner needs). The transcriber runs entirely in the renderer,
 * so there's nothing for main to know about.
 */

export interface VoiceModelOption {
  value: string;
  label: string;
  note: string;
}

/** English-only Whisper variants, smallest→largest. base.en is the default
 *  knee between footprint and accuracy for dictation. We use the `Xenova`
 *  repos (not `onnx-community`): they ship plain int8 quantization the WASM
 *  runtime can construct, whereas onnx-community's q8 build uses 4-bit
 *  MatMulNBits weights that only load under WebGPU. */
export const VOICE_MODEL_OPTIONS: VoiceModelOption[] = [
  { value: 'Xenova/whisper-tiny.en', label: 'Tiny (fastest)', note: '~25MB · quickest, least accurate' },
  { value: 'Xenova/whisper-base.en', label: 'Base (recommended)', note: '~50MB · good balance' },
  { value: 'Xenova/whisper-small.en', label: 'Small (most accurate)', note: '~180MB · slower, best quality' },
];

const ENABLED_KEY = 'minerva.voice.enabled';
const MODEL_KEY = 'minerva.voice.model';
const DEFAULT_MODEL = 'Xenova/whisper-base.en';

// localStorage may be absent or a stub under tests / non-browser contexts;
// fall back to defaults rather than throwing at module-eval time.
function lsGet(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // best-effort persistence; ignore quota/availability errors
  }
}

function readEnabled(): boolean {
  // Default on: the affordance is unobtrusive and only downloads a model when
  // first used. Users who never click it pay nothing.
  return lsGet(ENABLED_KEY) !== 'false';
}

function readModel(): string {
  const stored = lsGet(MODEL_KEY);
  return VOICE_MODEL_OPTIONS.some((o) => o.value === stored) ? (stored as string) : DEFAULT_MODEL;
}

let enabled = $state(readEnabled());
let model = $state(readModel());

export const voiceSettings = {
  get enabled() {
    return enabled;
  },
  set enabled(v: boolean) {
    enabled = v;
    lsSet(ENABLED_KEY, String(v));
  },
  get model() {
    return model;
  },
  set model(v: string) {
    model = v;
    lsSet(MODEL_KEY, v);
  },
};
