// Real log-mel filterbank frontend (Kaldi/torchaudio-style). Speaker-embedding models
// (ECAPA-TDNN, CAM++, x-vector) typically take fbank features, not raw waveform. This is
// genuine DSP — pre-emphasis → framing → Hamming window → radix-2 FFT → power spectrum →
// triangular mel filterbank → log — pure + deterministic + unit-tested, no native deps.
// On-device: features are derived from local audio and never leave the phone.

export interface FbankOptions {
  sampleRate?: number;
  numMel?: number;
  frameMs?: number;
  hopMs?: number;
  nFft?: number;
  fMin?: number;
  fMax?: number;
  preEmphasis?: number;
}

export interface Fbank {
  /** Row-major [frames × numMel] log-mel energies. */
  data: Float32Array;
  frames: number;
  numMel: number;
}

const hzToMel = (hz: number): number => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number): number => 700 * (10 ** (mel / 2595) - 1);

/** In-place iterative radix-2 Cooley-Tukey FFT (n must be a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k;
        const b = a + (len >> 1);
        const vr = re[b] * cwr - im[b] * cwi;
        const vi = re[b] * cwi + im[b] * cwr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const ncwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = ncwr;
      }
    }
  }
}

/** Precompute triangular mel filters as (leftBin, centerBin, rightBin) per mel band. */
function melFilters(numMel: number, nFft: number, sr: number, fMin: number, fMax: number) {
  const bins = nFft / 2 + 1;
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);
  const points = Array.from({ length: numMel + 2 }, (_, i) =>
    melToHz(melMin + ((melMax - melMin) * i) / (numMel + 1)),
  );
  const binOf = (hz: number) => Math.floor(((nFft + 1) * hz) / sr);
  return Array.from({ length: numMel }, (_, m) => ({
    left: binOf(points[m]),
    center: binOf(points[m + 1]),
    right: binOf(points[m + 2]),
    bins,
  }));
}

/** Compute the log-mel filterbank of a mono PCM signal. */
export function logMelFbank(pcm: Float32Array, opts: FbankOptions = {}): Fbank {
  const sr = opts.sampleRate ?? 16000;
  const numMel = opts.numMel ?? 80;
  const nFft = opts.nFft ?? 512;
  const frameLen = Math.round(((opts.frameMs ?? 25) * sr) / 1000);
  const hop = Math.round(((opts.hopMs ?? 10) * sr) / 1000);
  const fMin = opts.fMin ?? 20;
  const fMax = opts.fMax ?? sr / 2;
  const preEmph = opts.preEmphasis ?? 0.97;

  const filters = melFilters(numMel, nFft, sr, fMin, fMax);
  const window = Array.from({ length: frameLen }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frameLen - 1)));

  const frames = pcm.length >= frameLen ? 1 + Math.floor((pcm.length - frameLen) / hop) : 0;
  const out = new Float32Array(frames * numMel);
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);

  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    re.fill(0);
    im.fill(0);
    // pre-emphasis + window into the padded FFT buffer
    for (let i = 0; i < frameLen; i++) {
      const s = pcm[start + i];
      const prev = start + i - 1 >= 0 ? pcm[start + i - 1] : 0;
      re[i] = (s - preEmph * prev) * window[i];
    }
    fft(re, im);
    // triangular mel integration over the power spectrum
    for (let m = 0; m < numMel; m++) {
      const { left, center, right } = filters[m];
      let e = 0;
      for (let b = left; b < right && b < nFft / 2 + 1; b++) {
        if (b < 0) continue;
        const power = re[b] * re[b] + im[b] * im[b];
        const w = b <= center ? (center === left ? 1 : (b - left) / (center - left)) : center === right ? 1 : (right - b) / (right - center);
        e += power * Math.max(0, w);
      }
      out[f * numMel + m] = Math.log(e + 1e-6);
    }
  }
  return { data: out, frames, numMel };
}
