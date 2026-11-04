import SwiftUI

@main
struct KeppeChatApp: App {
    var body: some Scene { WindowGroup { ChatView() } }
}

struct ChatView: View {
    @StateObject private var vm = ChatViewModel()
    @StateObject private var speech = SpeechManager()
    @StateObject private var purchases = PurchaseManager()
    @State private var input = ""
    @State private var readAloud = true

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(vm.messages) { m in bubble(m).id(m.id) }
                    }.padding()
                }
                .onChange(of: vm.messages.count) { _, _ in
                    if let last = vm.messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            Divider()
            composer
            Text("Ferramenta de estudo. Não substitui terapia nem apoio profissional. Em emergência, liga 112.")
                .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal).padding(.bottom, 6)
        }
        .task { await vm.refresh(); await purchases.load() }
        .onChange(of: speech.transcript) { _, t in if speech.listening { input = t } }
        .sheet(isPresented: $vm.showPaywall) { paywallSheet }
    }

    private var header: some View {
        HStack {
            Text("Trilogia Chat").font(.headline)
            Spacer()
            Text(vm.remainingText).font(.footnote).foregroundStyle(.secondary)
            Button { readAloud.toggle(); if !readAloud { speech.stopSpeaking() } } label: {
                Image(systemName: readAloud ? "speaker.wave.2.fill" : "speaker.slash")
            }.accessibilityLabel("Ler respostas em voz alta")
        }.padding()
    }

    @ViewBuilder private func bubble(_ m: ChatMessage) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(m.text)
            ForEach(m.citations) { c in
                VStack(alignment: .leading, spacing: 4) {
                    Text("“\(c.excerpt)”").font(.callout)
                    Text(c.book + (c.page.map { ", p. \($0)" } ?? "")).font(.caption).foregroundStyle(.secondary)
                    if let url = URL(string: c.buyUrl) {
                        Link("Comprar na \(vm.publisher?.name ?? "editora")", destination: url).font(.callout.bold())
                    }
                }
                .padding(8)
                .background(Color.accentColor.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(12)
        .foregroundStyle(m.isUser ? Color.white : Color.primary)
        .background(m.isUser ? Color.accentColor : Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .frame(maxWidth: .infinity, alignment: m.isUser ? .trailing : .leading)
    }

    private var composer: some View {
        HStack(spacing: 8) {
            Button {
                Task { speech.listening ? speech.stop() : await speech.start() }
            } label: {
                Image(systemName: speech.listening ? "stop.circle.fill" : "mic.circle.fill").font(.title)
            }.accessibilityLabel(speech.listening ? "Parar de ouvir" : "Falar")
            TextField("Escreve a tua pergunta…", text: $input).textFieldStyle(.roundedBorder)
                .submitLabel(.send).onSubmit(submit)
            Button("Enviar", action: submit).disabled(vm.sending || input.isEmpty)
        }.padding()
    }

    private func submit() {
        speech.stop()
        let text = input; input = ""
        Task {
            if let reply = await vm.send(text), readAloud { speech.speak(reply) }
        }
    }

    private var paywallSheet: some View {
        VStack(spacing: 16) {
            Text("Os teus \(vm.paywall?.freeMinutes ?? 10) minutos gratuitos acabaram").font(.title3.bold()).multilineTextAlignment(.center)
            if let p = vm.paywall {
                Text("Continua com \(p.weeklyMinutes) minutos por semana.")
            }
            Button {
                Task { if await purchases.buy() { await vm.refresh() } }
            } label: {
                Text(purchases.product.map { "Subscrever por \($0.displayPrice)" } ?? "Subscrever")
                    .frame(maxWidth: .infinity)
            }.buttonStyle(.borderedProminent).disabled(purchases.purchasing || purchases.product == nil)
            Button("Restaurar compras") { Task { await purchases.restore(); await vm.refresh() } }
            // Termos e privacidade sao obrigatorios na pagina de subscricao da Apple.
            HStack { Link("Termos", destination: URL(string: "https://example.com/termos")!)
                     Link("Privacidade", destination: URL(string: "https://example.com/privacidade")!) }.font(.footnote)
            if let e = purchases.error { Text(e).foregroundStyle(.red).font(.footnote) }
        }.padding(24).presentationDetents([.medium])
    }
}
