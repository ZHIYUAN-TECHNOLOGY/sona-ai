import { memo } from "react";
import MaskedView from "@react-native-masked-view/masked-view";
import { Canvas, Circle, RadialGradient, vec } from "@shopify/react-native-skia";
import { BlobOverlay } from "@native-springs/shaders";
import { orbPad } from "./orb";

/**
 * The folding light Sona becomes while the patient talks (./voice-orb): @native-springs/shaders' BlobOverlay (Metal) in
 * the pearl's own colours (./orb: white highlights, an azure body, a violet blush; picked over the brighter brand pair
 * #2563EB → #9333EA, which read louder than the rest of Care), so pearl and light read as one object. The shader draws light for dark screens (alpha follows brightness), so on Care's pale
 * canvas its haze would end in a hard square; a radial mask fades it into the canvas instead, as the canvas's own fields
 * fade. `speechLevel` (0–1, the voice) steers its pulse. Same box as the pearl (`size + 2 × orbPad`). Native view only:
 * a development or TestFlight build, never Expo Go. It draws every frame while mounted, so it is mounted only while voice
 * is on. Trial (9 Oct): the shader is adapted from a Shadertoy original with no stated licence.
 */
export const FoldingLight = memo(function FoldingLight({ size, state, speechLevel }: { size: number; state: "listening" | "speaking"; speechLevel: number }) {
  const W = size + orbPad(size) * 2, c = vec(W / 2, W / 2);
  return <MaskedView pointerEvents="none" style={{ width: W, height: W }} maskElement={
    <Canvas style={{ width: W, height: W }}>
      <Circle c={c} r={W / 2}><RadialGradient c={c} r={W / 2} colors={["black", "black", "transparent"]} positions={[0, 0.55, 1]} /></Circle>
    </Canvas>}>
    <BlobOverlay state={state} mode="focused" speechLevel={speechLevel}
      parameters={{ color: "#4F7FEE", secondaryColor: "#A97BF0", scale: 1, renderScale: 0.5, transitionDuration: 0.3 }}
      style={{ width: W, height: W }} />
  </MaskedView>;
});
