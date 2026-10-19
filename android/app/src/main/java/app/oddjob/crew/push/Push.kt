package app.oddjob.crew.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.oddjob.crew.BuildConfig
import app.oddjob.crew.CrewApplication
import app.oddjob.crew.MainActivity
import app.oddjob.crew.R
import app.oddjob.crew.data.OddjobApi
import app.oddjob.crew.data.SessionStore
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/** Where push stands on this install, for Settings. */
enum class PushStatus {
    /** The build has no google-services.json, so Firebase is not part of it. */
    NOT_IN_BUILD,
    /** The server has no Firebase service account. */
    SERVER_OFF,
    /** Android notification permission is not granted. */
    PERMISSION_OFF,
    REGISTERED,
    FAILED,
}

/**
 * Registers this install's FCM token with the Oddjob server, and removes it on
 * sign-out. Every step is a no-op when Firebase is not configured, so the app
 * runs without it.
 */
object PushRegistrar {
    const val CHANNEL_ID = "approvals"
    const val EXTRA_URL = "url"

    fun firebaseInBuild(context: Context): Boolean = FirebaseApp.getApps(context).isNotEmpty()

    fun permissionGranted(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Called after sign-in, on app start while signed in, and when FCM rotates the token. */
    suspend fun register(context: Context, api: OddjobApi, session: SessionStore, token: String? = null): PushStatus {
        if (!firebaseInBuild(context)) return PushStatus.NOT_IN_BUILD
        return runCatching {
            if (!api.pushConfig().devices) return PushStatus.SERVER_OFF
            val fcmToken = token ?: FirebaseMessaging.getInstance().token.await()
            api.registerDevice(fcmToken, BuildConfig.VERSION_NAME)
            session.pushToken = fcmToken
            if (permissionGranted(context)) PushStatus.REGISTERED else PushStatus.PERMISSION_OFF
        }.getOrElse { PushStatus.FAILED }
    }

    /** Before the session ends, so the server stops pushing to a signed-out phone. */
    suspend fun unregister(context: Context, api: OddjobApi, session: SessionStore) {
        val token = session.pushToken ?: return
        runCatching { api.unregisterDevice(token) }
        session.pushToken = null
        if (firebaseInBuild(context)) runCatching { FirebaseMessaging.getInstance().deleteToken().await() }
    }

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL_ID, "Approvals and missions", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Approvals waiting for you and missions you started finishing"
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    /** Shows a push while the app is in the foreground; in the background the system shows it. */
    fun show(context: Context, title: String, body: String, url: String?, tag: String?) {
        if (!permissionGranted(context)) return
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (url != null) putExtra(EXTRA_URL, url)
        }
        val pending = PendingIntent.getActivity(
            context,
            (tag ?: url ?: title).hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_oddjob)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        @Suppress("MissingPermission") // checked by permissionGranted above
        NotificationManagerCompat.from(context).notify(tag, (tag ?: title).hashCode(), notification)
    }
}

/** Receives FCM messages and token rotations. */
class OddjobMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val app = application as CrewApplication
        if (app.session.username == null) return // registers at the next sign-in
        app.scope.launch { PushRegistrar.register(app, app.api, app.session, token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title ?: message.data["title"] ?: "Oddjob"
        val body = message.notification?.body ?: message.data["body"] ?: ""
        PushRegistrar.show(this, title, body, message.data[PushRegistrar.EXTRA_URL], message.data["tag"])
    }
}
