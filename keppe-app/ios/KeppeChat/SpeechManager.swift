import Foundation
import Speech
import AVFoundation

// Ditado por voz (pt-PT) e leitura da resposta em voz alta.
@MainActor
final class SpeechManager: NSObject, ObservableObject {
    @Published var listening = false
    @Published var transcript = ""

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "pt-PT"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let synth = AVSpeechSynthesizer()

    func start() async {
        guard await SFSpeechRecognizer.requestAuthorization() == .authorized else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
        try? session.setActive(true, options: .notifyOthersOnDeactivation)

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        request = req
        transcript = ""

        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buf, _ in req.append(buf) }
        engine.prepare()
        try? engine.start()
        listening = true

        task = recognizer?.recognitionTask(with: req) { [weak self] result, error in
            Task { @MainActor in
                if let result { self?.transcript = result.bestTranscription.formattedString }
                if error != nil || result?.isFinal == true { self?.stop() }
            }
        }
    }

    func stop() {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        listening = false
    }

    func speak(_ text: String) {
        synth.stopSpeaking(at: .immediate)
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "pt-PT")
        u.rate = 0.48
        synth.speak(u)
    }

    func stopSpeaking() { synth.stopSpeaking(at: .immediate) }
}
