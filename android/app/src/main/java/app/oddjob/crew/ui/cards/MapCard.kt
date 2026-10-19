package app.oddjob.crew.ui.cards

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import app.oddjob.crew.BuildConfig
import app.oddjob.crew.data.MapCardData
import app.oddjob.crew.data.MapPlace
import com.mapbox.geojson.Point
import com.mapbox.maps.Style
import com.mapbox.maps.extension.compose.MapEffect
import com.mapbox.maps.extension.compose.MapboxMap
import com.mapbox.maps.extension.compose.animation.viewport.MapViewportState
import com.mapbox.maps.extension.compose.animation.viewport.rememberMapViewportState
import com.mapbox.maps.extension.compose.annotation.generated.CircleAnnotation
import com.mapbox.maps.extension.compose.annotation.generated.PolylineAnnotation
import com.mapbox.maps.extension.compose.style.MapStyle
import com.mapbox.maps.plugin.PuckBearing
import com.mapbox.maps.plugin.gestures.gestures
import com.mapbox.maps.plugin.locationcomponent.createDefault2DPuck
import com.mapbox.maps.plugin.locationcomponent.location

private val markerColor = Color(0xFFA855F7)

/**
 * An `assistant_map` turn card. A map preview that does not steal the
 * transcript's scroll; tapping it opens a full-screen map to pan and zoom.
 * Without a Mapbox token in the build, the places are listed with
 * "Open in Maps" links instead.
 */
/**
 * The person's map preference, from Settings. [asked]/[markAsked] keep the
 * first map card's permission prompt to a single time.
 */
class MapLocationPrefs(val enabled: Boolean, val asked: Boolean, val markAsked: () -> Unit)

@Composable
fun MapCard(data: MapCardData, prefs: MapLocationPrefs) {
    var fullScreen by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    val location = rememberLocationRequest(prefs)
    CardSurface {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(data.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            data.description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (BuildConfig.MAPS_ENABLED) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(220.dp)
                        .clip(RoundedCornerShape(8.dp)),
                ) {
                    CrewMap(data, interactive = false, showLocation = location.showing, modifier = Modifier.fillMaxSize())
                    // Over the map, so a tap opens it instead of panning inside the scrolling transcript.
                    Box(Modifier.fillMaxSize().clickable { fullScreen = true })
                    Surface(
                        color = Color.Black.copy(alpha = 0.6f),
                        shape = RoundedCornerShape(4.dp),
                        modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp),
                    ) {
                        Text("Tap to explore", style = MaterialTheme.typography.labelSmall, color = Color.White, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                    }
                }
            } else {
                Text(
                    "Maps are off in this build (no Mapbox token). Places are listed below.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            routeLine(data)?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            (data.waypoints.ifEmpty { data.markers }).forEachIndexed { i, place ->
                PlaceRow(if (data.waypoints.isNotEmpty()) "${i + 1}" else "•", place) { openInMaps(context, place) }
            }
            if (BuildConfig.MAPS_ENABLED && !location.showing) {
                OutlinedButton(onClick = location.request) { Text("Show my location") }
            }
            if (location.denied) {
                Text(
                    "Location permission was not granted, so your position is not shown.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
    if (fullScreen) FullScreenMap(data, location) { fullScreen = false }
}

/** Whether this card shows the viewer's position, and how to ask for it. */
private class LocationRequest(val showing: Boolean, val denied: Boolean, val request: () -> Unit)

/**
 * With the Settings preference on (the default), a map shows the person's
 * position: straight away when permission is granted, and the first map card
 * ever shown asks for it once. Turned off, it shows only on a tap.
 */
@Composable
private fun rememberLocationRequest(prefs: MapLocationPrefs): LocationRequest {
    val context = LocalContext.current
    fun granted() = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    var showing by rememberSaveable { mutableStateOf(prefs.enabled && granted()) }
    var denied by rememberSaveable { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        showing = result.values.any { it }
        denied = !showing
    }
    val ask = { launcher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) }
    androidx.compose.runtime.LaunchedEffect(prefs.enabled) {
        if (prefs.enabled && !granted() && !prefs.asked) {
            prefs.markAsked()
            ask()
        }
    }
    return LocationRequest(showing, denied) { if (granted()) showing = true else ask() }
}

private fun routeLine(data: MapCardData): String? {
    if (data.routePoints.size < 2) return null
    return listOfNotNull(
        if (data.routeSnapped) "Route" else "Straight line between stops (no routing data)",
        data.distanceKm?.let { "%.1f km".format(it) },
        data.durationMin?.let { m -> if (m >= 60) "%d h %d min".format((m / 60).toInt(), (m % 60).toInt()) else "${m.toInt()} min" },
    ).joinToString(" · ")
}

@Composable
private fun PlaceRow(marker: String, place: MapPlace, onOpen: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(marker, style = MaterialTheme.typography.labelLarge, color = markerColor)
        Column(Modifier.weight(1f)) {
            Text(place.label ?: "%.4f, %.4f".format(place.lat, place.lng), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
            place.description?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        TextButton(onClick = onOpen) { Text("Open in Maps") }
    }
}

/** Hands a place to whatever maps app the phone has (geo: URI). */
private fun openInMaps(context: android.content.Context, place: MapPlace) {
    val label = Uri.encode(place.label ?: "Location")
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("geo:${place.lat},${place.lng}?q=${place.lat},${place.lng}($label)"))
    runCatching { context.startActivity(intent) }
}

@Composable
private fun FullScreenMap(data: MapCardData, location: LocationRequest, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Box(Modifier.fillMaxSize()) {
                CrewMap(data, interactive = true, showLocation = location.showing, modifier = Modifier.fillMaxSize())
                Row(
                    Modifier.safeDrawingPadding().padding(8.dp).fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f)) {
                        TextButton(onClick = onClose) { Text("Close") }
                    }
                    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f)) {
                        TextButton(onClick = location.request) { Text(if (location.showing) "Showing you" else "My location") }
                    }
                }
            }
        }
    }
}

@Composable
private fun CrewMap(data: MapCardData, interactive: Boolean, showLocation: Boolean, modifier: Modifier) {
    val focus = data.focus
    val viewport: MapViewportState = rememberMapViewportState {
        setCameraOptions {
            focus?.let { (lat, lng) -> center(Point.fromLngLat(lng, lat)) }
            zoom(if (focus == null) 1.5 else data.cameraZoom)
        }
    }
    val style = when (data.style) {
        "satellite" -> Style.SATELLITE_STREETS
        "streets" -> Style.STANDARD
        else -> Style.DARK
    }
    MapboxMap(
        modifier = modifier,
        mapViewportState = viewport,
        style = { MapStyle(style = style) },
        // The Compose map draws its ornaments itself; the view plugin is not installed,
        // so `mapView.scalebar` would be null. Preview: no scale bar; full screen: one.
        scaleBar = { if (interactive) ScaleBar(alignment = androidx.compose.ui.Alignment.BottomEnd, contentPadding = androidx.compose.foundation.layout.PaddingValues(end = 12.dp, bottom = 36.dp)) },
    ) {
        MapEffect(interactive, showLocation) { mapView ->
            mapView.gestures.updateSettings {
                scrollEnabled = interactive
                pinchToZoomEnabled = interactive
                rotateEnabled = interactive
                pitchEnabled = interactive
                doubleTapToZoomInEnabled = interactive
                doubleTouchToZoomOutEnabled = interactive
                quickZoomEnabled = interactive
            }
            mapView.location.updateSettings {
                enabled = showLocation
                locationPuck = createDefault2DPuck(withBearing = false)
                puckBearing = PuckBearing.HEADING
            }
        }
        // Centred on the person when the map has nothing of its own to frame;
        // a map of places keeps them in view and adds the person's dot.
        if (showLocation && data.empty) {
            androidx.compose.runtime.LaunchedEffect(Unit) { viewport.transitionToFollowPuckState() }
        }
        if (data.routePoints.size >= 2) {
            PolylineAnnotation(points = data.routePoints.map { (lng, lat) -> Point.fromLngLat(lng, lat) }) {
                lineColor = markerColor
                lineWidth = 4.0
                lineOpacity = if (data.routeSnapped) 1.0 else 0.7
            }
        }
        (data.markers + data.waypoints).forEach { place ->
            CircleAnnotation(point = Point.fromLngLat(place.lng, place.lat)) {
                circleRadius = 8.0
                circleColor = markerColor
                circleStrokeWidth = 2.0
                circleStrokeColor = Color.White
            }
        }
    }
}
