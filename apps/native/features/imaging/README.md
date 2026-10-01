# Imaging UI

`XrayCard` integrates with the response catalogue. `XrayScreen` uses the active encounter and the platform photo picker to open an explicitly selected local image. It does not classify or infer findings. It uploads only in live backend mode (`features/live/xray-upload.ts`, to the server's `xray.upload`), and the image's provenance line says so. Empty, picker-error, cancelled-picker, loading-image and unreadable-image states are distinct. The original displayed image has no tint, blur or shader. Incidental findings (demo flow 6, `features/findings`) appear as numbered rings laid over it, labelled "Unvalidated", never drawn into the pixels. A ring marks only the image it was read from (`onImage`): the authored findings sit on the bundled reference film alone, and a chosen image shows only a model's read of that very upload, or none.

The encounter retains the selected URI for the current app session. Reset clears it; the picker cache is not durable clinical storage. Selection results are ignored if the screen unmounts or the active patient changes while the picker is open.

Response cards render their captured `imagingSnapshot`. Their original-image action opens the saved card by ID and patient ID. The viewer resolves that ID only inside the active encounter, verifies patient and encounter identity, and shows the saved image without edit/analysis controls. Missing snapshots never fall back silently to a replacement image. A separate action opens the current image for new analysis. Retrying an old response is labelled as acting on the current encounter image.

`OriginalImageViewer` accepts a `TeachingImage` with source and provenance. Its pan/pinch transformations run in Gesture Handler/Reanimated worklets. Explicit zoom/reset buttons supplement the gestures. A real-device check is still required for gesture interruption, image sizing and large text.

A CC0 teaching image is bundled; see [asset provenance](assets/PROVENANCE.md). Its uploader's description appears only as a reference summary, explicitly unrelated to the selected patient and not a model result. A user-selected image replaces the reference preview and always shows unavailable findings. The reference description is never applied to a local image. If the bundled fixture is omitted, the missing-image layout remains available.

Picker API checked against installed Expo SDK 57 and [Expo ImagePicker documentation](https://docs.expo.dev/versions/latest/sdk/imagepicker/). No permissions are proactively requested for selecting only still images through the system library picker.
