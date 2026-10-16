package com.ipercepts.icrm;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * iCRM (v1.4): opens a WhatsApp chat in the WhatsApp the person chose in the
 * app's Settings — WhatsApp, WhatsApp Business, or "ask every time".
 * A phone with both apps used to open WhatsApp Business only (it takes the
 * wa.me links for itself); here the app names the one to open.
 * When the chosen one is not on the phone, the other one opens.
 */
@CapacitorPlugin(name = "PhoneApps")
public class PhoneAppsPlugin extends Plugin {

    private static final String WHATSAPP = "com.whatsapp";
    private static final String BUSINESS = "com.whatsapp.w4b";

    @SuppressWarnings("deprecation")
    private boolean installed(String pkg) {
        try {
            getContext().getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    /** which WhatsApp apps this phone has: { whatsapp, business } */
    @PluginMethod
    public void whatsappApps(PluginCall call) {
        JSObject out = new JSObject();
        out.put("whatsapp", installed(WHATSAPP));
        out.put("business", installed(BUSINESS));
        call.resolve(out);
    }

    /** a chat with a number (and a message ready to send); no number: the message, to choose the person in WhatsApp */
    private Intent intentFor(String pkg, String phone, String text) {
        Intent i;
        if (phone != null && !phone.isEmpty()) {
            String url = "https://api.whatsapp.com/send?phone=" + Uri.encode(phone)
                + (text != null && !text.isEmpty() ? "&text=" + Uri.encode(text) : "");
            i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        } else {
            i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
        }
        i.setPackage(pkg);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return i;
    }

    /** { phone (digits with the country code), text, app: "ask" | "whatsapp" | "business" } */
    @PluginMethod
    public void openWhatsApp(PluginCall call) {
        String phone = call.getString("phone", "");
        String text = call.getString("text", "");
        String app = call.getString("app", "ask");
        boolean hasWa = installed(WHATSAPP);
        boolean hasWb = installed(BUSINESS);
        if (!hasWa && !hasWb) {
            call.reject("WhatsApp is not on this phone.", "NO_WHATSAPP");
            return;
        }
        String pkg;
        if ("whatsapp".equals(app)) pkg = hasWa ? WHATSAPP : BUSINESS;
        else if ("business".equals(app)) pkg = hasWb ? BUSINESS : WHATSAPP;
        else pkg = (hasWa && hasWb) ? null : (hasWa ? WHATSAPP : BUSINESS);
        try {
            if (pkg == null) {
                // both on the phone and "ask every time": the phone shows both to choose from
                Intent chooser = Intent.createChooser(intentFor(WHATSAPP, phone, text), "Open with");
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { intentFor(BUSINESS, phone, text) });
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(chooser);
            } else {
                getActivity().startActivity(intentFor(pkg, phone, text));
            }
            JSObject out = new JSObject();
            out.put("opened", pkg == null ? "ask" : pkg);
            call.resolve(out);
        } catch (ActivityNotFoundException e) {
            call.reject("WhatsApp could not be opened.", "NO_WHATSAPP");
        } catch (Exception e) {
            call.reject("WhatsApp could not be opened: " + e.getMessage(), "NO_WHATSAPP");
        }
    }
}
