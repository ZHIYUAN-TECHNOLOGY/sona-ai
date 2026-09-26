import { useState } from "react";
import { api, errorText, useLive } from ".";

export type XrayUpload = { uri: string; state: "uploading" | "uploaded" | "failed"; key?: string; error?: string };

/**
 * In live mode a chosen X-ray is uploaded to the server's image store (R2, under the hospital's own
 * prefix). Nothing reads it: the server's X-ray model is a labelled fixture until the models are on.
 */
export function useXrayUpload() {
  const { on } = useLive();
  const [upload, setUpload] = useState<XrayUpload>();
  const send = async (encounterId: string, asset: { uri: string; base64?: string | null; mimeType?: string | null }) => {
    if (!asset.base64) { setUpload({ uri: asset.uri, state: "failed", error: "The image could not be read for upload" }); return; }
    setUpload({ uri: asset.uri, state: "uploading" });
    try {
      const { key } = await api.xray.upload({ encounterId, contentType: asset.mimeType ?? "image/jpeg", dataBase64: asset.base64 });
      setUpload({ uri: asset.uri, state: "uploaded", key });
    } catch (e) { setUpload({ uri: asset.uri, state: "failed", error: errorText(e) }); }
  };
  return { live: on, upload, send };
}
