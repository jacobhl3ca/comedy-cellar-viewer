package com.jacobhl.tonightnyc;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TonightGoogleAuthPlugin.class);
        super.onCreate(savedInstanceState);
        loadAppLink(getIntent());
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
