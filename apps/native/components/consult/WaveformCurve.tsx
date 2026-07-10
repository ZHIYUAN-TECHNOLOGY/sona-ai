import { Canvas, LinearGradient, Path, Skia, vec } from "@shopify/react-native-skia";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useDerivedValue, useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";

import { WAVE_POINTS } from "@/lib/audio/useMicAmplitude";
import { buildWavePath } from "@/lib/audio/waveform";
import { colors } from "@/lib/theme";

const HEIGHT = 44;

/**
 * Premium continuous waveform (react-native-skia). A single smooth, gradient-filled
 * curve — the amplitude ring is temporally eased toward on every frame (lerp) so the
 * curve flows fluidly regardless of the source update rate, then rendered as a mirrored
 * quadratic-smoothed Skia Path with a horizontal green gradient. All on the UI thread.
 */
export function WaveformCurve({ amplitudes }: { amplitudes: SharedValue<number[]> }) {
  const [width, setWidth] = useState(0);

  // Temporally-eased copy of the amplitudes: each frame lerp toward the live target so
  // the 31 Hz mic pushes (or 60 fps idle) render as a continuously smooth curve.
  const eased = useSharedValue<number[]>(new Array(WAVE_POINTS).fill(0));
  useFrameCallback(() => {
    "worklet";
    eased.modify((e) => {
      "worklet";
      const a = amplitudes.value;
      for (let i = 0; i < e.length; i++) e[i] += ((a[i] ?? 0) - e[i]) * 0.22;
      return e;
    });
  });

  const path = useDerivedValue(() => {
    if (width <= 0) return Skia.Path.Make();
    return Skia.Path.MakeFromSVGString(buildWavePath(eased.value, width, HEIGHT)) ?? Skia.Path.Make();
  }, [width]);

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {width > 0 ? (
        <Canvas style={{ width, height: HEIGHT }}>
          <Path path={path}>
            <LinearGradient
              start={vec(0, HEIGHT / 2)}
              end={vec(width, HEIGHT / 2)}
              colors={[colors.green, colors.greenDeep, colors.green]}
            />
          </Path>
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { width: "100%", height: HEIGHT } });
