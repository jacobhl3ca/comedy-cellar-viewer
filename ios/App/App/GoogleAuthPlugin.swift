import UIKit
import Capacitor
import AuthenticationServices

@objc(TonightGoogleAuthPlugin)
public class TonightGoogleAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TonightGoogleAuthPlugin"
    public let jsName = "TonightGoogleAuth"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)]
    private var authSession: ASWebAuthenticationSession?
    private var pendingCall: CAPPluginCall?

    @objc func authorize(_ call: CAPPluginCall) {
        guard pendingCall == nil else { call.reject("another sign-in is already in progress"); return }
        guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https",
              ["tonightnyc.com", "www.tonightnyc.com"].contains(url.host?.lowercased() ?? ""),
              call.getString("callbackScheme") == "tonight-auth"
        else { call.reject("invalid authentication URL"); return }
        pendingCall = call
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "tonight-auth") { [weak self] callback, error in
            DispatchQueue.main.async {
                guard let self, let pending = self.pendingCall else { return }
                self.authSession = nil; self.pendingCall = nil
                if let callback { pending.resolve(["callbackUrl": callback.absoluteString]) }
                else {
                    let nsError = error as NSError?
                    pending.reject(nsError?.code == ASWebAuthenticationSessionError.canceledLogin.rawValue
                        ? "canceled" : (error?.localizedDescription ?? "authentication failed"))
                }
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        guard session.start() else { authSession = nil; pendingCall = nil; call.reject("could not start authentication session"); return }
    }
}

extension TonightGoogleAuthPlugin: ASWebAuthenticationPresentationContextProviding {
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window
            ?? UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
            ?? ASPresentationAnchor()
    }
}
