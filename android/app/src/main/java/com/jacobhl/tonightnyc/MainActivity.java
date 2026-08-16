package com.jacobhl.tonightnyc;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TonightGoogleAuthPlugin.class);
        super.onCreate(savedInstanceState);
        installBackHandler();
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
}
