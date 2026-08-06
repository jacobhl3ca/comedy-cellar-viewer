import Capacitor

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(TonightAppleAuthPlugin())
        bridge?.registerPluginInstance(TonightGoogleAuthPlugin())
    }
}
