import { AudioContext } from "react-native-audio-api";
import { Asset } from "expo-asset";
import type { DecodingOptions, TranscriptionResult } from "react-native-executorch";
import { timed, StageMetric } from "./metrics";

const STT_GO_MS = 90_000; // 60s clip must transcribe in <= 90s

// Resolve the bundled wav to a local file uri the AudioContext can decode.
// expo-asset downloads the bundled asset to the local cache and exposes localUri.
async function sampleUri(): Promise<string> {
  const asset = Asset.fromModule(require("../assets/sample-consult.wav"));
  await asset.downloadAsync();
  return asset.localUri ?? asset.uri;
}

// `model` is the object returned by useSpeechToText (passed in from the screen).
export async function runSttBench(model: {
  transcribe: (waveform: Float32Array, options?: DecodingOptions) => Promise<TranscriptionResult>;
}): Promise<StageMetric> {
  const uri = await sampleUri();
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const decoded = await audioContext.decodeAudioData(uri);
  const buffer = decoded.getChannelData(0);

  const { result, ms } = await timed(() => model.transcribe(buffer)); // multilingual auto-detect
  return {
    stage: "stt",
    ms,
    ok: ms <= STT_GO_MS && result.text.trim().length > 0,
    output: result.text.slice(0, 400),
  };
}
