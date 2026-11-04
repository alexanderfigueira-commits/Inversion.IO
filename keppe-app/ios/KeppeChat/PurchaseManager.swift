import StoreKit

// Subscricao com StoreKit 2. Cria no App Store Connect um produto de subscricao
// com este identificador e o preco de 50 EUR (ou o que decidires).
@MainActor
final class PurchaseManager: ObservableObject {
    static let productID = "pt.keppechat.subscription.monthly"

    @Published var product: Product?
    @Published var purchasing = false
    @Published var error: String?

    private let api = APIClient()

    func load() async {
        do { product = try await Product.products(for: [Self.productID]).first }
        catch { self.error = "Não foi possível carregar o preço." }
    }

    /// Devolve true se a compra ficou confirmada pelo servidor.
    func buy() async -> Bool {
        guard let product else { return false }
        purchasing = true
        defer { purchasing = false }
        do {
            switch try await product.purchase() {
            case .success(let result):
                guard case .verified(let tx) = result else { error = "Compra não verificada."; return false }
                try await api.verify(signedTransaction: result.jwsRepresentation)
                await tx.finish()
                return true
            case .userCancelled, .pending:
                return false
            @unknown default:
                return false
            }
        } catch {
            self.error = "A compra falhou. Tenta outra vez."
            return false
        }
    }

    /// Exigido pela Apple: botao para restaurar compras.
    func restore() async { try? await AppStore.sync() }
}
