import { Canvas, Path, Skia, type SkPath } from "@shopify/react-native-skia";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

import { haptic } from "@/lib/haptics";
import { colors, font, radius, space } from "@/lib/theme";

// Draw-to-sign pad: pan gesture → quadratic-smoothed Skia path, fully on-device.
// The signature is ceremonial (the cryptographic seal is the audio hash + audit
// log) — nothing is rasterized or persisted; drawing simply arms the Sign button.

const STROKE = 2.5;

export function SignaturePad({
  signed,
  signedLabel,
  onFirstStroke,
  onClear,
}: {
  /** Once signed the pad is frozen: strokes stay, Clear disappears. */
  signed: boolean;
  /** Name rendered under the ink once signed. */
  signedLabel: string;
  /** Fires when the first stroke lands — parent enables "Sign and finish". */
  onFirstStroke: () => void;
  /** Fires when the pad is cleared — parent disarms signing. */
  onClear: () => void;
}) {
  const [paths, setPaths] = useState<SkPath[]>([]);
  // Bump to force re-render while the live path mutates (Skia paths are refs).
  const [, setTick] = useState(0);

  const begin = useCallback(
    (x: number, y: number) => {
      const p = Skia.Path.Make();
      p.moveTo(x, y);
      setPaths((prev) => {
        if (prev.length === 0) onFirstStroke();
        return [...prev, p];
      });
    },
    [onFirstStroke],
  );

  const extend = useCallback((x: number, y: number) => {
    setPaths((prev) => {
      const last = prev[prev.length - 1];
      if (last) {
        const pt = last.getLastPt();
        // Quadratic midpoint smoothing — raw lineTo polylines look jagged.
        last.quadTo(pt.x, pt.y, (pt.x + x) / 2, (pt.y + y) / 2);
      }
      return prev;
    });
    setTick((t) => t + 1);
  }, []);

  const pan = Gesture.Pan()
    .enabled(!signed)
    .minDistance(0)
    .maxPointers(1)
    .onBegin((e) => {
      runOnJS(begin)(e.x, e.y);
    })
    .onUpdate((e) => {
      runOnJS(extend)(e.x, e.y);
    });

  const clear = () => {
    haptic("tap");
    setPaths([]);
    onClear();
  };

  const empty = paths.length === 0;

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View style={[styles.pad, signed && styles.padSigned]}>
          <Canvas style={StyleSheet.absoluteFill}>
            {paths.map((p, i) => (
              <Path
                key={i}
                path={p}
                color={signed ? colors.greenInk : colors.ink}
                style="stroke"
                strokeWidth={STROKE}
                strokeCap="round"
                strokeJoin="round"
              />
            ))}
          </Canvas>
          {empty ? (
            <Text style={styles.hint} pointerEvents="none">
              Sign here with your finger
            </Text>
          ) : null}
          {signed ? (
            <Text style={styles.signedLabel} pointerEvents="none">
              {signedLabel}
            </Text>
          ) : null}
        </View>
      </GestureDetector>
      {!empty && !signed ? (
        <Pressable onPress={clear} hitSlop={8} style={styles.clearBtn}>
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    height: 140,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
    marginTop: space.md,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  padSigned: { borderStyle: "solid", borderColor: colors.green100, backgroundColor: colors.green50 },
  hint: { ...font.bodySm, color: colors.ink3 },
  signedLabel: {
    position: "absolute",
    bottom: 8,
    ...font.bodySm,
    color: colors.greenInk,
    fontStyle: "italic",
  },
  clearBtn: { alignSelf: "flex-end", marginTop: space.sm, paddingHorizontal: 4 },
  clearText: { ...font.bodySm, color: colors.ink3, fontWeight: "600" },
});
