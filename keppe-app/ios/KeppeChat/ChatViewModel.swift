import Foundation

struct ChatMessage: Identifiable {
    let id = UUID()
    let isUser: Bool
    var text: String
    var citations: [Citation] = []
}

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = [
        ChatMessage(isUser: false, text: "Olá. Faz-me uma pergunta e eu respondo na lente da Trilogia Analítica, com excertos dos livros quando houver.")
    ]
    @Published var usage: Usage?
    @Published var paywall: Paywall?
    @Published var publisher: Publisher?
    @Published var sending = false
    @Published var showPaywall = false

    private let api = APIClient()

    var remainingText: String {
        guard let u = usage else { return "" }
        let m = u.remainingSeconds / 60, s = u.remainingSeconds % 60
        return (u.plan == "paid" ? "Esta semana: " : "Grátis: ") + String(format: "%d:%02d", m, s) + " restantes"
    }

    func refresh() async {
        guard let s = try? await api.status() else { return }
        usage = s.usage; paywall = s.paywall; publisher = s.publisher
        showPaywall = s.usage.locked
    }

    func send(_ text: String) async -> String? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !sending else { return nil }
        messages.append(ChatMessage(isUser: true, text: t))
        sending = true
        defer { sending = false }

        let history = messages.dropLast().suffix(10).map { ["role": $0.isUser ? "user" : "assistant", "content": $0.text] }
        do {
            let r = try await api.chat(message: t, history: Array(history))
            messages.append(ChatMessage(isUser: false, text: r.reply, citations: r.citations))
            usage = r.usage
            if let p = r.publisher { publisher = p }
            if r.usage.locked { showPaywall = true }
            return r.reply
        } catch APIError.limitReached(let u, let p) {
            usage = u; paywall = p; showPaywall = true
            return nil
        } catch {
            messages.append(ChatMessage(isUser: false, text: "Não consegui responder agora. Tenta outra vez."))
            return nil
        }
    }
}
