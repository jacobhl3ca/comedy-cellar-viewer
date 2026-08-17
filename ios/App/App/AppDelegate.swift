import UIKit
import Capacitor
import Sentry

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Native crash reporting, started before anything else can crash.
        //
        // The WebView loads tonightnyc.com, so this shell's own bundled JS never runs
        // — a JS-driven Sentry init (@sentry/capacitor) would be inert here. The
        // site's web SDK reports its own errors from inside the WebView; this
        // catches what only the native process can see: a hard crash, a watchdog
        // termination, an app hang. Same Sentry project as the web app, so both
        // halves of one incident land together.
        //
        // Tracing stays off deliberately: crashes are the blind spot, performance
        // spans are just quota.
        SentrySDK.start { options in
            options.dsn = "https://2b0ccd655533ea28979df00bdb820a8f@o4511667913818112.ingest.us.sentry.io/4511892769669120"
            options.environment = "production"
            options.tracesSampleRate = 0.0
        }

        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        //
        // This app is a `server.url` shell — the WebView loads tonightnyc.com itself —
        // so handling a universal link means pointing the existing WebView at the
        // incoming URL. Without this the link opens the app but leaves it on whatever
        // page it was already showing, which looks identical to the link being ignored.
        // @capacitor/app isn't a dependency here, so this is done natively rather than
        // by listening for `appUrlOpen` in JS.
        if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
           let url = userActivity.webpageURL,
           let host = url.host,
           host == "tonightnyc.com" || host == "www.tonightnyc.com",
           let bridgeVC = window?.rootViewController as? CAPBridgeViewController,
           let webView = bridgeVC.webView {
            webView.load(URLRequest(url: url))
            return true
        }

        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
