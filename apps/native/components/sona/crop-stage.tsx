import { Canvas, FillType, FilterMode, ImageFormat, MipmapMode, Path, Skia, type SkImage } from "@shopify/react-native-skia";
import { Image } from "expo-image";
import { useEffect, useImperativeHandle, useMemo, useState, type ReactNode, type Ref } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";
import { flatSize, homography, rectQuad, type Point, type Quad } from "./crop";

/**
 * The photo just taken, fitted into `frame`, with four corners the doctor drags onto the page's
 * edges (after a document scanner's adjust step). Outside the corners dims; the corners start on
 * the photo's own edges, so a wound or skin photo goes through untouched. `straighten()` redraws
 * the chosen area flat and returns the new file, or nothing when the corners were not moved.
 * The photo itself is shown by expo-image (decoded and downsampled off the main thread); Skia draws
 * only the corners and shade, and decodes the full photo once, when it is straightened.
 */
export type CropHandle = { straighten(): Promise<string | undefined> };
type Rect = { x: number; y: number; width: number; height: number };
const PAD = 18; // room for a corner handle on the photo's edge
const GRAB = 44; // touch radius around each corner

export function CropStage({ ref, source, frame, editable, children }: {
  ref?: Ref<CropHandle>; source: string | number; frame: Rect; editable: boolean;
  /** Drawn over the photo (for example, the reading sweep), placed on its fitted rect in the parent's space. */
  children?: (photo: Rect) => ReactNode;
}) {
  const [size, setSize] = useState<{ width: number; height: number }>();
  // The photo's rect inside the frame (contain), in frame coordinates.
  const photo = useMemo(() => {
    if (!size) return undefined;
    const s = Math.min((frame.width - PAD * 2) / size.width, (frame.height - PAD * 2) / size.height);
    const width = size.width * s, height = size.height * s;
    return { x: (frame.width - width) / 2, y: (frame.height - height) / 2, width, height };
  }, [size, frame.width, frame.height]);

  const corners = useSharedValue<Point[]>([]);
  const active = useSharedValue(-1), grab = useSharedValue({ x: 0, y: 0 });
  useEffect(() => { if (photo) corners.set(rectQuad(photo.x, photo.y, photo.width, photo.height)); }, [photo, corners]);

  const pan = Gesture.Pan().enabled(editable && Boolean(photo)).minDistance(0)
    .onBegin(e => {
      let best = -1, dist = GRAB;
      corners.get().forEach((c, i) => { const d = Math.hypot(c.x - e.x, c.y - e.y); if (d < dist) { dist = d; best = i; } });
      active.set(best);
      if (best >= 0) grab.set({ x: corners.get()[best]!.x - e.x, y: corners.get()[best]!.y - e.y });
    })
    .onUpdate(e => {
      const i = active.get();
      if (i < 0 || !photo) return;
      const next = corners.get().slice();
      next[i] = { x: Math.min(photo.x + photo.width, Math.max(photo.x, e.x + grab.get().x)), y: Math.min(photo.y + photo.height, Math.max(photo.y, e.y + grab.get().y)) };
      corners.set(next);
    })
    .onFinalize(() => active.set(-1));

  const outline = useDerivedValue(() => {
    const c = corners.get(), b = Skia.PathBuilder.Make();
    if (c.length === 4) { b.moveTo(c[0]!.x, c[0]!.y); c.slice(1).forEach(p => b.lineTo(p.x, p.y)); b.close(); }
    return b.detach();
  });
  const shade = useDerivedValue(() => {
    const c = corners.get(), b = Skia.PathBuilder.Make().setFillType(FillType.EvenOdd);
    if (photo && c.length === 4) {
      b.addRect(Skia.XYWHRect(photo.x, photo.y, photo.width, photo.height));
      b.moveTo(c[0]!.x, c[0]!.y); c.slice(1).forEach(p => b.lineTo(p.x, p.y)); b.close();
    }
    return b.detach();
  });
  const handles = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    corners.get().forEach((c, i) => b.addCircle(c.x, c.y, i === active.get() ? 13 : 10));
    return b.detach();
  });

  useImperativeHandle(ref, () => ({
    async straighten() {
      const c = corners.get();
      if (typeof source !== "string" || !photo || c.length !== 4) return undefined;
      const start = rectQuad(photo.x, photo.y, photo.width, photo.height);
      if (c.every((p, i) => Math.hypot(p.x - start[i]!.x, p.y - start[i]!.y) < 2)) return undefined;
      const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(source));
      if (!image) return undefined;
      try {
        const s = image.width() / photo.width;
        return await flatten(image, c.map(p => ({ x: (p.x - photo.x) * s, y: (p.y - photo.y) * s })) as Quad);
      } finally { image.dispose(); }
    },
  }), [source, photo, corners]);

  return <>
    <GestureDetector gesture={pan}>
      <View accessibilityLabel={editable ? "Photo. Drag a corner to crop" : "Photo"} style={{ position: "absolute", left: frame.x, top: frame.y, width: frame.width, height: frame.height }}>
        <Image source={source} contentFit="contain" onLoad={e => setSize({ width: e.source.width, height: e.source.height })}
          style={photo ? { position: "absolute", left: photo.x, top: photo.y, width: photo.width, height: photo.height } : { position: "absolute", inset: PAD }} />
        {editable && photo && <Canvas style={{ flex: 1 }}>
          <Path path={shade} color="rgba(6,9,14,0.55)" />
          <Path path={outline} style="stroke" strokeWidth={2} color="rgba(255,255,255,0.95)" />
          <Path path={handles} color="#FFFFFF" />
          <Path path={handles} style="stroke" strokeWidth={1.5} color="rgba(17,19,24,0.35)" />
        </Canvas>}
      </View>
    </GestureDetector>
    {photo && children?.({ x: frame.x + photo.x, y: frame.y + photo.y, width: photo.width, height: photo.height })}
  </>;
}

/** Redraws `quad` of `image` as a flat rectangle and saves it as a JPEG; returns its file URI. */
async function flatten(image: SkImage, quad: Quad): Promise<string> {
  const { width, height } = flatSize(quad);
  const surface = Skia.Surface.MakeOffscreen(width, height);
  if (!surface) throw new Error("No drawing surface for the crop");
  const canvas = surface.getCanvas();
  canvas.concat(Skia.Matrix(homography(quad, rectQuad(0, 0, width, height))));
  const all = Skia.XYWHRect(0, 0, image.width(), image.height());
  canvas.drawImageRectOptions(image, all, all, FilterMode.Linear, MipmapMode.Linear);
  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  const bytes = snapshot.encodeToBytes(ImageFormat.JPEG, 100);
  snapshot.dispose(); surface.dispose();
  const { Images } = require("react-native-nitro-image") as typeof import("react-native-nitro-image");
  const flat = await Images.loadFromEncodedImageDataAsync({ buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, width, height, imageFormat: "jpg" });
  // Free the pixels now; the garbage collector can't see how large a native image is.
  try { return `file://${await flat.saveToTemporaryFileAsync("jpg", 90)}`; } finally { flat.dispose(); }
}
