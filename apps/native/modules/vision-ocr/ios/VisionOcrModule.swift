import ExpoModulesCore
import Vision

// On-device OCR via Apple Vision. `.accurate` recognition + language correction is
// markedly better than ML Kit on printed clinical documents and usably better on
// handwriting; observations are re-sorted into reading order (Vision's normalized
// coordinates put the origin at the BOTTOM-left, so top of page = highest y).
// The image never leaves the device; nothing here touches the network.
public class VisionOcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VisionOcr")

    AsyncFunction("recognize") { (uri: String, promise: Promise) in
      guard let url = URL(string: uri), url.isFileURL else {
        promise.reject("E_BAD_URI", "Expected a file:// URI, got: \(uri)")
        return
      }

      let request = VNRecognizeTextRequest { req, error in
        if let error = error {
          promise.reject("E_OCR", error.localizedDescription)
          return
        }
        let observations = (req.results as? [VNRecognizedTextObservation]) ?? []
        let lines: [(text: String, x: CGFloat, y: CGFloat)] = observations.compactMap { obs in
          guard let top = obs.topCandidates(1).first else { return nil }
          return (top.string, obs.boundingBox.minX, obs.boundingBox.minY)
        }
        // Reading order: top-to-bottom (descending y — bottom-left origin), then
        // left-to-right within a line band. The 0.02 band tolerance keeps words on
        // the same physical line together even when their boxes wobble slightly.
        let sorted = lines.sorted { a, b in
          if abs(a.y - b.y) > 0.02 { return a.y > b.y }
          return a.x < b.x
        }
        promise.resolve([
          "text": sorted.map { $0.text }.joined(separator: "\n"),
          "boxes": sorted.count,
        ])
      }
      request.recognitionLevel = .accurate
      // en-US correction also passes Malay through mostly untouched (same Latin
      // alphabet, correction is conservative); zh-Hans covers 中文 on bilingual
      // paperwork. Malay is not a Vision language, so it can't be listed directly.
      request.recognitionLanguages = ["en-US", "zh-Hans"]
      request.usesLanguageCorrection = true

      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let handler = VNImageRequestHandler(url: url, options: [:])
          try handler.perform([request])
        } catch {
          promise.reject("E_OCR", error.localizedDescription)
        }
      }
    }
  }
}
