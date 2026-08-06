package com.jacobhl.tonightnyc;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "TonightGoogleAuth")
public class TonightGoogleAuthPlugin extends Plugin {
    private String pendingCallback;

    @PluginMethod
    public void authorize(PluginCall call) {
        String raw = call.getString("url"); Uri url = raw == null ? null : Uri.parse(raw);
        if (url == null || !"https".equals(url.getScheme()) ||
                !("tonightnyc.com".equals(url.getHost()) || "www.tonightnyc.com".equals(url.getHost())) ||
                !"tonight-auth".equals(call.getString("callbackScheme"))) {
            call.reject("invalid authentication URL"); return;
        }
        getActivity().startActivity(new Intent(Intent.ACTION_VIEW, url));
        JSObject result = new JSObject(); result.put("launched", true); call.resolve(result);
    }

    @PluginMethod
    public void consumeCallback(PluginCall call) {
        if (pendingCallback == null) {
            Intent intent = getActivity().getIntent(); Uri data = intent == null ? null : intent.getData();
            if (isCallback(data)) { pendingCallback = data.toString(); intent.setData(null); }
        }
        JSObject result = new JSObject();
        if (pendingCallback != null) { result.put("callbackUrl", pendingCallback); pendingCallback = null; }
        call.resolve(result);
    }

    @Override protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent); Uri data = intent == null ? null : intent.getData();
        if (isCallback(data)) { pendingCallback = data.toString(); intent.setData(null); }
    }
    private boolean isCallback(Uri uri) {
        return uri != null && "tonight-auth".equals(uri.getScheme()) && "google".equals(uri.getHost());
    }
}
