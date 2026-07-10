import { Canvas, LinearGradient, Path, Skia, vec } from "@shopify/react-native-skia";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { buildWavePath } from "@/lib/audio/waveform";
import { colors } from "@/lib/theme";

const HEIGHT = 44;

/**
 * Premium continuous waveform (react-native-skia): one smooth, gradient-filled curve.
 * `amplitudes` is already temporally smoothed by the parent (per-frame lerp), so here we
 * just rebuild the mirrored quadratic path (buildWavePath) each frame and fill it with a
 * horizontal green gradient — all on the UI thread. Loaded lazily by WaveformCurve; if
 * the Skia native module isn't in the binary this file's import throws and the caller
 * falls back to bars.
 */
export function SkiaWaveform({ amplitudes }: { amplitudes: SharedValue<number[]> }) {
  const [width, setWidth] = useState(0);

  const path = useDerivedValue(() => {
    if (width <= 0) return Skia.Path.Make();
    return Skia.Path.MakeFromSVGString(buildWavePath(amplitudes.value, width, HEIGHT)) ?? Skia.Path.Make();
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
