package com.jacobhl.tonightnyc;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import android.os.Build;
import android.webkit.RenderProcessGoneDetail;
import com.getcapacitor.WebViewListener;
import io.sentry.Sentry;
import io.sentry.SentryEvent;
import io.sentry.SentryLevel;
import io.sentry.protocol.Message;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TonightGoogleAuthPlugin.class);
        super.onCreate(savedInstanceState);
        installBackHandler();
        reportRendererCrashes();
        loadAppLink(getIntent());
    }

    // Capacitor's own Android layer has no back-button handling, and @capacitor/app is
    // not a dependency here either (see loadAppLink below), so Back fell through to the
    // default Activity behaviour and closed the app from any depth. Opening a show or a
    // comedian and pressing Back dropped the user out of Tonight NYC instead of
    // returning to the lineup, which is what closed testers reported.
    private void installBackHandler() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    finish();
                }
            }
        });
    }

    // The activity is singleTask, so a link tapped while the app is already running
    // arrives here rather than through onCreate.
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadAppLink(intent);
    }

    // This app is a server.url shell — the WebView loads tonightnyc.com itself — so
    // handling an app link means pointing that WebView at the incoming URL. Without
    // this the link opens the app but leaves it on whatever page it was showing,
    // which is indistinguishable from the link being ignored. @capacitor/app isn't a
    // dependency, so this is done natively instead of via an appUrlOpen listener.
    private void loadAppLink(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri uri = intent.getData();
        if (uri == null) return;
        if (!"https".equals(uri.getScheme())) return;  // tonight-auth:// is the plugin's, not ours
        String host = uri.getHost();
        if (!"tonightnyc.com".equals(host) && !"www.tonightnyc.com".equals(host)) return;
        if (getBridge() == null || getBridge().getWebView() == null) return;
        final String url = uri.toString();
        runOnUiThread(() -> getBridge().getWebView().loadUrl(url));
    }

    // A WebView renderer crash happens in a DIFFERENT process
    // (com.google.android.webview:sandboxed_process0), so sentry-android — which
    // lives in this process — cannot see it. Until now it only ever got reported by
    // accident, on the occasions when the renderer's death dragged this process down
    // with it. Android hands the event to the app process here instead.
    //
    // Returning false is deliberate: the platform then terminates this process,
    // which is exactly what happens today. This closes the reporting blind spot
    // without changing behaviour. Recovering the WebView in place (return true,
    // rebuild it, reload server.url) is a bigger call and a separate one.
    //
    // flush() blocks the UI thread for up to two seconds, which is acceptable in a
    // process that is about to be killed and is the only way the event survives.
    private void reportRendererCrashes() {
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                boolean crashed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail.didCrash();
                SentryEvent event = new SentryEvent();
                event.setLevel(SentryLevel.FATAL);
                Message message = new Message();
                // didCrash() false means Android killed the renderer to reclaim
                // memory rather than the renderer faulting. Same dead app, very
                // different fix, so keep them in separate Sentry groups.
                message.setMessage(crashed
                    ? "WebView renderer crashed"
                    : "WebView renderer killed by the system (out of memory)");
                event.setMessage(message);
                Sentry.captureEvent(event);
                Sentry.flush(2000);
                return false;
            }
        });
    }
}
