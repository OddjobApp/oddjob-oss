package app.oddjob.crew.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * Keeps `oddjob.sid` across process death. express-session issues it with a
 * 30-day maxAge, so it is a persistent cookie and survives restarts exactly as
 * it does in a browser; without this every cold start would be a fresh login.
 */
class PersistentCookieJar(private val store: KeyValueStore) : CookieJar {

    @Serializable
    private data class Stored(
        val name: String,
        val value: String,
        val expiresAt: Long,
        val domain: String,
        val path: String,
        val secure: Boolean,
        val httpOnly: Boolean,
        val hostOnly: Boolean,
        val persistent: Boolean,
    )

    private val json = Json { ignoreUnknownKeys = true }
    private val serializer = ListSerializer(Stored.serializer())
    private val cookies: MutableList<Cookie> = load().toMutableList()

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        for (cookie in cookies) {
            this.cookies.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
            if (cookie.expiresAt > System.currentTimeMillis()) this.cookies.add(cookie)
        }
        persist()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        if (cookies.removeAll { it.expiresAt <= now }) persist()
        return cookies.filter { it.matches(url) }
    }

    @Synchronized
    fun clear() {
        cookies.clear()
        persist()
    }

    @Synchronized
    fun hasCookie(name: String): Boolean = cookies.any { it.name == name }

    private fun persist() {
        // Session-only cookies are not written to disk, as a browser would not.
        val stored = cookies.filter { it.persistent }.map {
            Stored(it.name, it.value, it.expiresAt, it.domain, it.path, it.secure, it.httpOnly, it.hostOnly, it.persistent)
        }
        store.put(KEY, json.encodeToString(serializer, stored))
    }

    private fun load(): List<Cookie> {
        val raw = store.get(KEY) ?: return emptyList()
        val stored = runCatching { json.decodeFromString(serializer, raw) }.getOrDefault(emptyList())
        val now = System.currentTimeMillis()
        return stored.filter { it.expiresAt > now }.map { s ->
            Cookie.Builder()
                .name(s.name)
                .value(s.value)
                .expiresAt(s.expiresAt)
                .path(s.path)
                .apply {
                    if (s.hostOnly) hostOnlyDomain(s.domain) else domain(s.domain)
                    if (s.secure) secure()
                    if (s.httpOnly) httpOnly()
                }
                .build()
        }
    }

    private companion object {
        const val KEY = "cookies"
    }
}
