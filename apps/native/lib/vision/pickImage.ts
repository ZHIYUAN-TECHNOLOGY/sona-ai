import * as ImagePicker from "expo-image-picker";

// Image source for OCR — camera or photo library, via expo-image-picker. Guarded: returns
// null if permission is denied, the user cancels, or the native module is unavailable. The
// picked image is a local file URI handed straight to on-device OCR; it never leaves the phone.

/** Capture a document with the camera. Returns a local URI, or null. */
export async function captureFromCamera(): Promise<string | null> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
    const res = await ImagePicker.launchCameraAsync({ quality: 1 });
    return res.canceled ? null : (res.assets[0]?.uri ?? null);
  } catch {
    return null;
  }
}

/** Pick a document image from the photo library. Returns a local URI, or null. */
export async function pickFromLibrary(): Promise<string | null> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 1 });
    return res.canceled ? null : (res.assets[0]?.uri ?? null);
  } catch {
    return null;
  }
}
