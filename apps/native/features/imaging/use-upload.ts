import { File } from "expo-file-system";
import { useSyncExternalStore } from "react";
import { api, errorText, useLive } from "@/features/live";
import { refreshFindings } from "@/features/live/findings-sync";
import { useLiveXray } from "@/features/live/model-sync";
import { useRole } from "@/features/live/roles";
import { readingOf, sendXray, subscribe, uploadOf, type XrayAsset } from "./upload";

/**
 * Live mode: an attached X-ray goes to the server's image store (R2, under the hospital's own prefix) by one path,
 * wherever it was attached, and its findings are then detected from it. A role the server refuses keeps the image on
 * this device, as demo mode does.
 */
export function useXrayAttach() {
  const { on } = useLive();
  const { can } = useRole();
  const live = on && can("xray.upload");
  const detect = can("findings.detect");
  const attach = (encounterId: string, asset: XrayAsset) => {
    if (!live) return;
    void sendXray(encounterId, asset, {
      read: uri => new File(uri).base64(), upload: input => api.xray.upload(input), errorText,
      // The X-ray page shows a failed detection when it opens (it detects again); the visit's card shows the reading only.
      stored: id => { if (detect) void refreshFindings(id).catch(() => {}); },
    });
  };
  return { live, attach };
}

/** The upload of this visit's image `uri`, if it was sent this session. */
export const useXrayUploadOf = (encounterId: string | undefined, uri: string | undefined) =>
  useSyncExternalStore(subscribe, () => uploadOf(encounterId, uri));

/**
 * The image model's reading of the visit's image `uri` and no other (`readingOf`): asked only once that image is
 * stored, under its storage key, so the card and its lead share one ask. Undefined in demo mode or for an image that
 * was never sent.
 */
export function useXrayReading(encounterId: string, uri: string | undefined) {
  const upload = useXrayUploadOf(encounterId, uri);
  return readingOf(upload, useLiveXray(encounterId, upload?.state === "uploaded" ? upload.key : undefined));
}
