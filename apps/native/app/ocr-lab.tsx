import { Stack } from "expo-router";

import OcrLab from "@/spike/OcrLab";

// Dev-only route: on-device document OCR (scan → extract → de-identify).
// Reached from Settings → About.
export default function OcrLabRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Document OCR" }} />
      <OcrLab />
    </>
  );
}
