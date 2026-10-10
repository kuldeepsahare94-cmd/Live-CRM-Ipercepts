package com.ipercepts.icrm;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.CallLog;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * iCRM: reads the phone's own call history (start, length, answered or not) and
 * finds the recording the phone's dialer made of a call, so the CRM can save it.
 * Nothing is changed on the phone; the app only reads.
 */
@CapacitorPlugin(
    name = "CallLog",
    permissions = {
        @Permission(alias = "callLog", strings = { Manifest.permission.READ_CALL_LOG }),
        @Permission(alias = "audio", strings = { "android.permission.READ_MEDIA_AUDIO" }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class CallLogPlugin extends Plugin {

    private static final int MAX_BYTES = 12 * 1024 * 1024;

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private String audioPermission() {
        return Build.VERSION.SDK_INT >= 33 ? "android.permission.READ_MEDIA_AUDIO" : Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    /** What the app may read now. */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("callLog", granted(Manifest.permission.READ_CALL_LOG));
        r.put("audio", granted(audioPermission()));
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("maker", Build.MANUFACTURER);
        call.resolve(r);
    }

    @PluginMethod
    public void requestCallLog(PluginCall call) {
        if (granted(Manifest.permission.READ_CALL_LOG)) { status(call); return; }
        requestPermissionForAlias("callLog", call, "afterPermission");
    }

    @PluginMethod
    public void requestAudio(PluginCall call) {
        if (granted(audioPermission())) { status(call); return; }
        requestPermissionForAlias(Build.VERSION.SDK_INT >= 33 ? "audio" : "storage", call, "afterPermission");
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        status(call);
    }

    private static String typeName(int t) {
        switch (t) {
            case CallLog.Calls.INCOMING_TYPE: return "in";
            case CallLog.Calls.OUTGOING_TYPE: return "out";
            case CallLog.Calls.MISSED_TYPE: return "missed";
            case CallLog.Calls.REJECTED_TYPE: return "rejected";
            case CallLog.Calls.BLOCKED_TYPE: return "blocked";
            case CallLog.Calls.VOICEMAIL_TYPE: return "voicemail";
            default: return "other";
        }
    }

    /** Calls since a time (ms), newest first: { calls: [{ id, number, type, date, duration, name }] } */
    @PluginMethod
    public void getCalls(PluginCall call) {
        if (!granted(Manifest.permission.READ_CALL_LOG)) { call.reject("no permission", "NO_PERMISSION"); return; }
        long since = call.getLong("since", 0L);
        int limit = Math.max(1, Math.min(500, call.getInt("limit", 100)));
        String[] cols = { CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION, CallLog.Calls.CACHED_NAME };
        JSArray list = new JSArray();
        Cursor c = null;
        try {
            c = getContext().getContentResolver().query(
                CallLog.Calls.CONTENT_URI, cols,
                CallLog.Calls.DATE + " >= ?", new String[] { String.valueOf(since) },
                CallLog.Calls.DATE + " DESC");
            int n = 0;
            while (c != null && c.moveToNext() && n < limit) {
                JSObject o = new JSObject();
                o.put("id", c.getLong(0));
                o.put("number", c.isNull(1) ? "" : c.getString(1));
                o.put("type", typeName(c.getInt(2)));
                o.put("date", c.getLong(3));
                o.put("duration", c.getLong(4));
                o.put("name", c.isNull(5) ? "" : c.getString(5));
                list.put(o);
                n++;
            }
        } catch (Exception e) {
            call.reject("could not read the call history: " + e.getMessage());
            return;
        } finally {
            if (c != null) c.close();
        }
        JSObject r = new JSObject();
        r.put("calls", list);
        call.resolve(r);
    }

    /**
     * Sound files the phone saved between two times (ms):
     * { files: [{ id, name, size, mime, duration, path, added }] }. The app picks the call recording.
     */
    @PluginMethod
    public void findRecordings(PluginCall call) {
        if (!granted(audioPermission())) { call.reject("no permission", "NO_PERMISSION"); return; }
        long from = call.getLong("from", 0L) / 1000L;
        long to = call.getLong("to", System.currentTimeMillis()) / 1000L;
        boolean q = Build.VERSION.SDK_INT >= 29;
        String pathCol = q ? MediaStore.MediaColumns.RELATIVE_PATH : MediaStore.MediaColumns.DATA;
        String[] cols = {
            MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.MIME_TYPE, MediaStore.Audio.AudioColumns.DURATION, pathCol,
            MediaStore.MediaColumns.DATE_ADDED, MediaStore.MediaColumns.DATE_MODIFIED
        };
        String where = "(" + MediaStore.MediaColumns.DATE_ADDED + " BETWEEN ? AND ?) OR (" + MediaStore.MediaColumns.DATE_MODIFIED + " BETWEEN ? AND ?)";
        String[] args = { String.valueOf(from), String.valueOf(to), String.valueOf(from), String.valueOf(to) };
        JSArray list = new JSArray();
        Cursor c = null;
        try {
            c = getContext().getContentResolver().query(audioUri(), cols, where, args, MediaStore.MediaColumns.DATE_ADDED + " DESC");
            int n = 0;
            while (c != null && c.moveToNext() && n < 30) {
                JSObject o = new JSObject();
                o.put("id", c.getLong(0));
                o.put("name", c.isNull(1) ? "" : c.getString(1));
                o.put("size", c.getLong(2));
                o.put("mime", c.isNull(3) ? "" : c.getString(3));
                o.put("duration", c.isNull(4) ? 0 : c.getLong(4));
                o.put("path", c.isNull(5) ? "" : c.getString(5));
                o.put("added", c.getLong(6) * 1000L);
                o.put("modified", c.getLong(7) * 1000L);
                list.put(o);
                n++;
            }
        } catch (Exception e) {
            call.reject("could not look for recordings: " + e.getMessage());
            return;
        } finally {
            if (c != null) c.close();
        }
        JSObject r = new JSObject();
        r.put("files", list);
        call.resolve(r);
    }

    private static Uri audioUri() {
        if (Build.VERSION.SDK_INT >= 29) return MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL);
        return MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
    }

    /** One sound file as base64: { data, size } */
    @PluginMethod
    public void readAudio(PluginCall call) {
        if (!granted(audioPermission())) { call.reject("no permission", "NO_PERMISSION"); return; }
        Long id = call.getLong("id");
        if (id == null) { call.reject("id is needed"); return; }
        int max = Math.max(1, Math.min(MAX_BYTES, call.getInt("maxBytes", MAX_BYTES)));
        ContentResolver cr = getContext().getContentResolver();
        InputStream in = null;
        try {
            in = cr.openInputStream(ContentUris.withAppendedId(audioUri(), id));
            if (in == null) { call.reject("the file could not be opened"); return; }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int total = 0;
            int k;
            while ((k = in.read(buf)) != -1) {
                total += k;
                if (total > max) { call.reject("the recording is too big", "TOO_BIG"); return; }
                out.write(buf, 0, k);
            }
            JSObject r = new JSObject();
            r.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            r.put("size", total);
            call.resolve(r);
        } catch (OutOfMemoryError e) {
            call.reject("the recording is too big", "TOO_BIG");
        } catch (Exception e) {
            call.reject("the file could not be read: " + e.getMessage());
        } finally {
            if (in != null) {
                try { in.close(); } catch (Exception ignored) {}
            }
        }
    }
}
