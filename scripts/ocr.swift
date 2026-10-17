import Foundation
import ImageIO
import Vision

guard CommandLine.arguments.count == 2,
  let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL, nil),
  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
else { exit(2) }

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["ko-KR", "en-US"]
do {
  try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
} catch { exit(1) }

var lines: [[String: Any]] = []
for observation in request.results ?? [] {
  guard let candidate = observation.topCandidates(1).first else { continue }
  let box = observation.boundingBox
  lines.append([
    "text": candidate.string,
    "x": box.minX, "y": 1 - box.maxY, "w": box.width, "h": box.height,
  ])
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: lines))
