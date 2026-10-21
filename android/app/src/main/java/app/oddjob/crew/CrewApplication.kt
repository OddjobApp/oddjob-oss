package app.oddjob.crew

import android.app.Application
import app.oddjob.crew.data.OddjobApi
import app.oddjob.crew.data.PersistentCookieJar
import app.oddjob.crew.data.RoomCache
import app.oddjob.crew.data.SessionStore
import app.oddjob.crew.data.SharedPrefsStore
import app.oddjob.crew.push.PushRegistrar
import app.oddjob.crew.push.PushStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/** One API client per process, so every screen shares the cookie jar and CSRF token. */
class CrewApplication : Application(), coil3.SingletonImageLoader.Factory {
    lateinit var session: SessionStore
        private set
    lateinit var api: OddjobApi
        private set
    /** Recently opened rooms and the rooms list, for an instant open and offline reading. */
    lateinit var roomCache: RoomCache
        private set

    /** Work that outlives a screen: push registration and sign-out cleanup. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** A path a tapped notification asked to open, consumed once the user is signed in. */
    val pendingDeepLink = MutableStateFlow<String?>(null)

    /** The last push registration outcome, for Settings. */
    val pushStatus = MutableStateFlow<PushStatus?>(null)

    override fun onCreate() {
        super.onCreate()
        val store = SharedPrefsStore(this)
        session = SessionStore(store)
        val forgotOtherServer = BuildConfig.SERVER_URL_FIXED && session.forgetOtherServer(BuildConfig.DEFAULT_SERVER_URL)
        api = OddjobApi(session, PersistentCookieJar(store))
        roomCache = RoomCache(java.io.File(cacheDir, "rooms")) { RoomCache.ownerOf(session.serverUrl, session.username) }
        // The cached rooms belong to the forgotten server's account.
        if (forgotOtherServer) roomCache.clear()
        PushRegistrar.createChannel(this)
    }

    /**
     * Images load through the app's signed-in client, so room thumbnails
     * (session-protected) work; public thumbnails (YouTube, Amazon) are unaffected.
     */
    override fun newImageLoader(context: coil3.PlatformContext): coil3.ImageLoader =
        coil3.ImageLoader.Builder(context)
            .components { add(coil3.network.okhttp.OkHttpNetworkFetcherFactory(callFactory = { api.httpClient })) }
            .build()

    /** Registers this install for push; safe to call repeatedly. */
    fun registerPush() {
        scope.launch { pushStatus.value = PushRegistrar.register(this@CrewApplication, api, session) }
    }

    /** Unregisters push, then ends the server session. */
    suspend fun signOut() {
        PushRegistrar.unregister(this, api, session)
        pushStatus.value = null
        roomCache.clear()
        api.logout()
    }
}
