import UIKit
import Capacitor
import AuthenticationServices
import CryptoKit

/** Native Sign in with Apple for the Tonight NYC Capacitor shell. */
@objc(TonightAppleAuthPlugin)
public class TonightAppleAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TonightAppleAuthPlugin"
    public let jsName = "TonightAppleAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?

    @objc func authorize(_ call: CAPPluginCall) {
        guard let rawNonce = call.getString("nonce"), !rawNonce.isEmpty else {
            call.reject("a nonce is required")
            return
        }
        guard pendingCall == nil else {
            call.reject("another sign-in is already in progress")
            return
        }
        pendingCall = call

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = Self.sha256Hex(rawNonce)
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    private func finish(_ block: (CAPPluginCall) -> Void) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        block(call)
    }

    private static func sha256Hex(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

extension TonightAppleAuthPlugin: ASAuthorizationControllerDelegate {
    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8)
        else {
            finish { $0.reject("Apple returned no identity token") }
            return
        }

        var fullName: String?
        if let components = credential.fullName {
            let formatter = PersonNameComponentsFormatter()
            formatter.style = .long
            let joined = formatter.string(from: components).trimmingCharacters(in: .whitespacesAndNewlines)
            if !joined.isEmpty { fullName = joined }
        }

        finish {
            $0.resolve([
                "identityToken": identityToken,
                "user": credential.user,
                "email": credential.email as Any,
                "fullName": fullName as Any
            ])
        }
    }

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        let code = (error as NSError).code
        finish { $0.reject(code == ASAuthorizationError.canceled.rawValue ? "canceled (1001)" : error.localizedDescription) }
    }
}

extension TonightAppleAuthPlugin: ASAuthorizationControllerPresentationContextProviding {
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        bridge?.viewController?.view.window
            ?? UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first
            ?? ASPresentationAnchor()
    }
}
