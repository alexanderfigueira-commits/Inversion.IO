import Foundation
import Security

// Ajusta para o endereco do teu servidor. Em simulador, localhost funciona.
enum Backend {
    static let baseURL = URL(string: "http://localhost:8787")!
}

struct Usage: Codable, Equatable {
    var plan: String
    var limitSeconds: Int
    var usedSeconds: Int
    var remainingSeconds: Int
    var locked: Bool
}

struct Citation: Codable, Identifiable, Equatable {
    var n: Int
    var book: String
    var page: String?
    var excerpt: String
    var buyUrl: String
    var id: Int { n }
}

struct Paywall: Codable, Equatable {
    var priceEur: Double
    var period: String
    var weeklyMinutes: Int
    var freeMinutes: Int
}

struct Publisher: Codable, Equatable {
    var name: String
    var url: String
}

struct ChatResponse: Codable {
    var reply: String
    var citations: [Citation]
    var usage: Usage
    var crisis: Bool?
    var publisher: Publisher?
}

struct LimitResponse: Codable {
    var usage: Usage
    var paywall: Paywall
}

struct StatusResponse: Codable {
    var usage: Usage
    var paywall: Paywall
    var publisher: Publisher
}

enum APIError: Error {
    case limitReached(Usage, Paywall)
    case server
}

// Identificador do aparelho guardado na Keychain: sobrevive a reinstalar a app,
// o que dificulta repetir os 10 minutos gratis. Para mais robustez, usar DeviceCheck.
enum DeviceID {
    static var value: String {
        let key = "keppe.device.id"
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrAccount as String: key,
                                    kSecReturnData as String: true]
        var out: AnyObject?
        if SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
           let data = out as? Data, let s = String(data: data, encoding: .utf8) { return s }
        let new = UUID().uuidString
        let add: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                  kSecAttrAccount as String: key,
                                  kSecValueData as String: Data(new.utf8)]
        SecItemAdd(add as CFDictionary, nil)
        return new
    }
}

struct APIClient {
    private func request(_ path: String, body: Data? = nil) -> URLRequest {
        var r = URLRequest(url: Backend.baseURL.appendingPathComponent(path))
        r.httpMethod = body == nil ? "GET" : "POST"
        r.httpBody = body
        r.setValue("application/json", forHTTPHeaderField: "content-type")
        r.setValue(DeviceID.value, forHTTPHeaderField: "x-device-id")
        r.timeoutInterval = 40
        return r
    }

    func status() async throws -> StatusResponse {
        let (data, _) = try await URLSession.shared.data(for: request("api/status"))
        return try JSONDecoder().decode(StatusResponse.self, from: data)
    }

    func chat(message: String, history: [[String: String]]) async throws -> ChatResponse {
        let body = try JSONSerialization.data(withJSONObject: ["message": message, "history": history])
        let (data, resp) = try await URLSession.shared.data(for: request("api/chat", body: body))
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if code == 402 {
            let l = try JSONDecoder().decode(LimitResponse.self, from: data)
            throw APIError.limitReached(l.usage, l.paywall)
        }
        guard code == 200 else { throw APIError.server }
        return try JSONDecoder().decode(ChatResponse.self, from: data)
    }

    // Envia a transacao assinada (JWS) da Apple ao servidor, que a deve validar.
    func verify(signedTransaction: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["jws": signedTransaction])
        let (_, resp) = try await URLSession.shared.data(for: request("api/subscription/verify", body: body))
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw APIError.server }
    }
}
