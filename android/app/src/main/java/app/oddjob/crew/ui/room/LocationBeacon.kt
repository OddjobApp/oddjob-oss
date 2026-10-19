package app.oddjob.crew.ui.room

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant
import kotlin.coroutines.resume

/** One position, as the beacon sends it. */
data class BeaconFix(val lat: Double, val lng: Double, val accuracyM: Double?, val at: String)

/**
 * A single fresh fix from the best enabled provider, falling back to the last
 * known one. One request, no updates: a beacon shares a position, it does not track.
 */
@SuppressLint("MissingPermission") // callers check the permission first
suspend fun currentFix(context: Context): BeaconFix? {
    val lm = context.getSystemService(LocationManager::class.java) ?: return null
    val providers = buildList {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) add(LocationManager.FUSED_PROVIDER)
        add(LocationManager.GPS_PROVIDER)
        add(LocationManager.NETWORK_PROVIDER)
    }.filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
    val provider = providers.firstOrNull() ?: return null
    val fresh = withTimeoutOrNull(20_000) {
        suspendCancellableCoroutine<Location?> { cont ->
            val signal = CancellationSignal()
            LocationManagerCompat.getCurrentLocation(lm, provider, signal, ContextCompat.getMainExecutor(context)) { cont.resume(it) }
            cont.invokeOnCancellation { signal.cancel() }
        }
    }
    val loc = fresh ?: providers.firstNotNullOfOrNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() } ?: return null
    return BeaconFix(
        lat = loc.latitude,
        lng = loc.longitude,
        accuracyM = if (loc.hasAccuracy()) loc.accuracy.toDouble() else null,
        at = Instant.ofEpochMilli(loc.time).toString(),
    )
}

/**
 * Raising a beacon: permission, then one fix, then a confirmation that says
 * exactly who will see it, then the send. Nothing leaves the phone before the
 * person taps Share.
 */
@Composable
fun BeaconFlow(onShare: suspend (BeaconFix) -> String?, onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf("permission") } // permission | locating | confirm | sending | failed
    var fix by remember { mutableStateOf<BeaconFix?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    fun locate() {
        step = "locating"
        scope.launch {
            fix = currentFix(context)
            if (fix == null) {
                error = "Couldn't get your location. Check that location is on, then try again."
                step = "failed"
            } else step = "confirm"
        }
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result.values.any { it }) locate()
        else { error = "Location permission was not granted, so nothing was shared."; step = "failed" }
    }
    LaunchedEffect(Unit) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (granted) locate() else launcher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }

    when (step) {
        "locating", "sending", "permission" -> AlertDialog(
            onDismissRequest = onDone,
            title = { Text("Location beacon") },
            text = {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator()
                    Text(if (step == "sending") "Sharing your location…" else "Finding your location…")
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = onDone) { Text("Cancel") } },
        )
        "confirm" -> {
            val f = fix!!
            AlertDialog(
                onDismissRequest = onDone,
                title = { Text("Share your location?") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("%.5f, %.5f".format(f.lat, f.lng) + (f.accuracyM?.let { " (±%.0f m)".format(it) } ?: ""), style = MaterialTheme.typography.titleSmall)
                        Text(
                            "Your pin is posted to this room. Everyone in the room's project is notified (or everyone in the room, if it has no project), and the agents see your position on their next reply. It's shared once; it doesn't track you.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        step = "sending"
                        scope.launch {
                            val failure = onShare(f)
                            if (failure == null) onDone() else { error = failure; step = "failed" }
                        }
                    }) { Text("Share") }
                },
                dismissButton = { TextButton(onClick = onDone) { Text("Cancel") } },
            )
        }
        else -> AlertDialog(
            onDismissRequest = onDone,
            title = { Text("Location not shared") },
            text = { Text(error ?: "Something went wrong.") },
            confirmButton = { TextButton(onClick = ::locate) { Text("Try again") } },
            dismissButton = { TextButton(onClick = onDone) { Text("Close") } },
        )
    }
}
