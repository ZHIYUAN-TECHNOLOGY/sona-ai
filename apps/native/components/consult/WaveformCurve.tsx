import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedProps, type SharedValue } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { buildWavePath } from "@/lib/audio/waveform";
import { colors } from "@/lib/theme";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const HEIGHT = 40;

/**
 * Real-time waveform curve. Renders an SVG <Path> whose shape is recomputed on the
 * UI thread (useAnimatedProps + buildWavePath worklet) from a shared array of
 * amplitudes (0..1) the mic hook keeps updating. No React re-render per frame.
 */
export function WaveformCurve({ amplitudes }: { amplitudes: SharedValue<number[]> }) {
  const [width, setWidth] = useState(0);

  const animatedProps = useAnimatedProps(() => ({
    d: width > 0 ? buildWavePath(amplitudes.value, width, HEIGHT) : "",
  }));

  return (
    <View
      style={styles.wave}
      accessible={false}
      pointerEvents="none"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          <AnimatedPath animatedProps={animatedProps} fill={colors.green} />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wave: { height: HEIGHT, width: "100%", justifyContent: "center" },
});
