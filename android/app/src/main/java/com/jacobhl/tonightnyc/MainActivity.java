package com.jacobhl.tonightnyc;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TonightGoogleAuthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
