package app.oddjob.crew.data

import android.content.Context

/** The persistence the session needs, kept narrow so tests can use a map. */
interface KeyValueStore {
    fun get(key: String): String?
    fun put(key: String, value: String?)
}

class SharedPrefsStore(context: Context) : KeyValueStore {
    // App-private storage. The session cookie is a bearer credential for 30
    // days, so it never goes anywhere a backup or another app could read it:
    // allowBackup is off in the manifest.
    private val prefs = context.getSharedPreferences("oddjob_session", Context.MODE_PRIVATE)
    override fun get(key: String): String? = prefs.getString(key, null)
    override fun put(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }
}

class InMemoryStore : KeyValueStore {
    private val map = mutableMapOf<String, String>()
    override fun get(key: String): String? = map[key]
    override fun put(key: String, value: String?) {
        if (value == null) map.remove(key) else map[key] = value
    }
}

/** Which Oddjob origin the app talks to, and who is signed in there. */
class SessionStore(private val store: KeyValueStore) {
    var serverUrl: String?
        get() = store.get(KEY_SERVER)
        set(value) = store.put(KEY_SERVER, value?.let(::normalizeServerUrl))

    var username: String?
        get() = store.get(KEY_USER)
        set(value) = store.put(KEY_USER, value)

    /**
     * For a build whose server is fixed: forgets a sign-in saved against any other
     * server (an install from before the server was fixed, still on its old
     * address), so the person signs in once more at the fixed one. Leaving the
     * stored server null makes the next login clear the old server's cookies.
     * Returns whether anything was forgotten.
     */
    fun forgetOtherServer(fixed: String): Boolean {
        val saved = serverUrl ?: return false
        if (saved == normalizeServerUrl(fixed)) return false
        serverUrl = null
        username = null
        return true
    }

    /** Show tool chips and the serving model under agent turns. */
    var showTurnDetails: Boolean
        get() = store.get(KEY_DETAILS) != "false"
        set(value) = store.put(KEY_DETAILS, value.toString())

    /** The FCM token this install last registered with the server, to unregister on sign-out. */
    var pushToken: String?
        get() = store.get(KEY_PUSH_TOKEN)
        set(value) = store.put(KEY_PUSH_TOKEN, value)

    /** Put the person's own position on map cards, and centre maps with nothing else to show on it. On by default. */
    var useLocationOnMaps: Boolean
        get() = store.get(KEY_MAP_LOCATION) != "false"
        set(value) = store.put(KEY_MAP_LOCATION, value.toString())

    /** Whether a map card has already asked for the location permission once, so it never nags. */
    var askedLocationPermission: Boolean
        get() = store.get(KEY_ASKED_LOCATION) == "true"
        set(value) = store.put(KEY_ASKED_LOCATION, value.toString())

    /** Whether the app has already asked for the notification permission once. */
    var askedNotificationPermission: Boolean
        get() = store.get(KEY_ASKED_NOTIFY) == "true"
        set(value) = store.put(KEY_ASKED_NOTIFY, value.toString())

    companion object {
        private const val KEY_PUSH_TOKEN = "push_token"
        private const val KEY_MAP_LOCATION = "use_location_on_maps"
        private const val KEY_ASKED_LOCATION = "asked_location_permission"
        private const val KEY_ASKED_NOTIFY = "asked_notification_permission"
        private const val KEY_DETAILS = "show_turn_details"
        private const val KEY_SERVER = "server_url"
        private const val KEY_USER = "username"

        /** Trims, defaults the scheme to https, and drops trailing slashes. */
        fun normalizeServerUrl(raw: String): String {
            val trimmed = raw.trim().trimEnd('/')
            return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed
            else "https://$trimmed"
        }
    }
}
