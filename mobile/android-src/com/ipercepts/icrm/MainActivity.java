package com.ipercepts.icrm;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // iCRM's own plugin: the phone's call history and call recordings
        registerPlugin(CallLogPlugin.class);
        // (v1.4) WhatsApp or WhatsApp Business, as chosen in the app's Settings
        registerPlugin(PhoneAppsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
