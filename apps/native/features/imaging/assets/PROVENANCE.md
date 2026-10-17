# Bundled chest radiograph

- File: `normal-pa-chest.jpg`
- Creator: Mikael Häggström, uploaded as own work.
- Source: [Normal posteroanterior (PA) chest radiograph (X-ray)](https://commons.wikimedia.org/wiki/File:Normal_posteroanterior_(PA)_chest_radiograph_(X-ray).jpg).
- License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/), confirmed on the uploader's file page on 23 September 2026.
- Original: [Wikimedia JPEG](https://upload.wikimedia.org/wikipedia/commons/a/a1/Normal_posteroanterior_%28PA%29_chest_radiograph_%28X-ray%29.jpg), 1929 × 2207 pixels, 906,335 bytes.
- SHA-1: `3124c4cf4c55eb3d2defa9b909f08f94e941ec43`, matching the source page checksum. Downloaded bytes are unmodified.
- Inspection: no name, patient ID or birth date visible; only side markers. Pillow reported no EXIF entries. This is a public teaching example, not a clinical record imported from a hospital.

The source description identifies the chest as normal with no signs of injury. The UI paraphrases that description and labels it as a reference example. It must never be presented as model inference or as the selected synthetic patient's radiograph. No additional image interpretation was authored for this fixture.

# Amelia Tan's demo film

- File: `lobar-pneumonia-pa.jpg`, the film uploaded to the demo patient Amelia Tan's visit (SYN-1042) for the pitch: a real adult frontal chest radiograph of community-acquired lobar pneumonia, in the right lower zone as her note reads ("right lower zone consolidation").
- Creator: Mikael Häggström, M.D., uploaded as own work on 7 June 2018. The uploader records that written informed consent was obtained from the individual, including online publication.
- Source: [X-ray of lobar pneumonia](https://commons.wikimedia.org/wiki/File:X-ray_of_lobar_pneumonia.jpg).
- License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/), confirmed on the file page on 8 October 2026. No attribution is required; we credit it anyway.
- Attribution line: "Chest X-ray: Mikael Häggström, M.D. · Wikimedia Commons · CC0 1.0".
- Original: [Wikimedia JPEG](https://upload.wikimedia.org/wikipedia/commons/5/51/X-ray_of_lobar_pneumonia.jpg), 3027 × 2407 pixels, 3,155,438 bytes, SHA-1 `f8e927b2bfc4246de8c2356b5495818a429afbbe` (matches the file page).
- Changed: downscaled to 1600 × 1272 and re-encoded as JPEG (quality 88) with macOS `sips`, so an upload stays small; nothing else. Bundled SHA-1 `315f6434ab33b7d0bf635fde723a5a57c65faf4f`, 702,757 bytes.
- Inspection: no name, patient ID, date or accession number on the image; only the side marker "Sin". The original has no EXIF; the re-encoded file holds only resolution and size tags (written by `sips`), no text.
- The uploader describes a 67-year-old man with lobar pneumonia of the right middle lobe. On a frontal film that lobe lies in the right lower zone, so it is not Amelia's own radiograph (she is fictional, 42 and female), only a real film that fits her story. Sona Vision (MedGemma 1.5 4B on `sona-xray`) read this exact file five times on 8 October 2026 as right lower lobe or lower lung field consolidation or opacity, likely pneumonia, heart and left lung normal; "Read for findings" found 0 incidental findings (nodule, cardiomegaly, effusion) each time.
