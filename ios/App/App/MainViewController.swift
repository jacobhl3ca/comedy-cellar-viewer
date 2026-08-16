import Capacitor

/**
 Capacitor's stock bridge controller leaves WKWebView's edge-swipe gesture off,
 so inside the app there was no way back to the previous screen except hunting
 for an in-page back button. The app is a remote web app, so the web view's own
 history is exactly the right thing to walk. Matches the Android hardware-back
 handler in MainActivity.java.
 */
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(TonightAppleAuthPlugin())
        bridge?.registerPluginInstance(TonightGoogleAuthPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
    }
}
