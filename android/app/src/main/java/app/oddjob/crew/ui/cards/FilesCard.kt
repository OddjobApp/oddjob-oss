package app.oddjob.crew.ui.cards

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import app.oddjob.crew.data.RoomFile
import app.oddjob.crew.data.RoomFiles
import coil3.compose.AsyncImage
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Files someone uploaded, in the conversation: photos as server-made
 * thumbnails (a few KB, not the original), documents as preview cards. A photo
 * opens full screen at a larger thumbnail; a document opens in the phone's own
 * app for its type.
 */
@Composable
fun FilesCard(files: RoomFiles, actions: TurnCardActions) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var viewing by remember { mutableStateOf<RoomFile?>(null) }
    var opening by remember { mutableStateOf<Int?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    fun request(path: String) = ImageRequest.Builder(context)
        .data(actions.resolveUrl(path))
        .httpHeaders(NetworkHeaders.Builder().apply { actions.orgId?.let { set("x-organization-id", it.toString()) } }.build())
        .build()

    fun open(file: RoomFile) {
        opening = file.id
        error = null
        scope.launch {
            actions.downloadFile(file.id)
                .onSuccess { bytes ->
                    val opened = withContext(Dispatchers.IO) {
                        val dir = File(context.cacheDir, "downloads").apply { mkdirs() }
                        // Only the file being opened is kept.
                        dir.listFiles()?.forEach { it.delete() }
                        File(dir, file.name.replace(Regex("[\\\\/:*?\"<>|]"), "_")).apply { writeBytes(bytes) }
                    }
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", opened)
                    val intent = Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, file.mimeType ?: "application/octet-stream")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    try {
                        context.startActivity(Intent.createChooser(intent, file.name))
                    } catch (_: ActivityNotFoundException) {
                        error = "No app on this phone opens ${file.name}."
                    }
                }
                .onFailure { error = "Couldn't download ${file.name}: ${it.message}" }
            opening = null
        }
    }

    val images = files.items.filter { it.isImage }
    val documents = files.items.filterNot { it.isImage }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.widthIn(max = 320.dp)) {
        images.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { file ->
                    AsyncImage(
                        model = request(files.thumbnailPath(file, 480)),
                        contentDescription = file.name,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .weight(1f)
                            .aspectRatio(1f)
                            .clip(RoundedCornerShape(8.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .clickable { viewing = file },
                    )
                }
                // A lone photo keeps half the width, like the pair above it.
                if (row.size == 1 && images.size > 1) Box(Modifier.weight(1f))
            }
        }
        documents.forEach { file ->
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth().clickable(enabled = opening == null) { open(file) },
            ) {
                Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(documentBadge(file), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                        Text(file.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        if (opening == file.id) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                    }
                    Text(
                        listOfNotNull(
                            app.oddjob.crew.ui.room.readableSize(file.byteSize),
                            when (file.parseStatus) { "parsed" -> null; "pending" -> "reading…"; else -> "couldn't read" },
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    file.preview?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
        error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
    }

    viewing?.let { file ->
        Dialog(onDismissRequest = { viewing = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(Color.Black)) {
                AsyncImage(
                    model = request(files.thumbnailPath(file, 960)),
                    contentDescription = file.name,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize().clickable { viewing = null },
                )
                Row(Modifier.safeDrawingPadding().padding(8.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = { viewing = null }) { Text("Close", color = Color.White) }
                    TextButton(onClick = { viewing = null; open(file) }) { Text("Open original", color = Color.White) }
                }
            }
        }
    }
}

/** A short type label for a document card, from its extension. */
internal fun documentBadge(file: RoomFile): String =
    file.name.substringAfterLast('.', "").uppercase().take(4).ifEmpty { "FILE" }

/**
 * An image an agent generated (`assistant_image`): a same-origin path or an
 * https URL, never anything else. Same-origin images load through the signed-in
 * client; tap to see it full size.
 */
@Composable
fun GeneratedImageCard(card: CardKind.Image, actions: TurnCardActions) {
    val context = LocalContext.current
    var full by remember { mutableStateOf(false) }
    val request = remember(card.url, actions.orgId) {
        ImageRequest.Builder(context)
            .data(actions.resolveUrl(card.url))
            .httpHeaders(NetworkHeaders.Builder().apply { if (card.url.startsWith("/")) actions.orgId?.let { set("x-organization-id", it.toString()) } }.build())
            .build()
    }
    CardSurface {
        card.title?.let { Text(it, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold) }
        card.description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        AsyncImage(
            model = request,
            contentDescription = card.title ?: "Generated image",
            contentScale = ContentScale.FillWidth,
            modifier = Modifier.padding(top = 8.dp).fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { full = true },
        )
    }
    if (full) {
        Dialog(onDismissRequest = { full = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(Color.Black).clickable { full = false }) {
                AsyncImage(model = request, contentDescription = card.title, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
            }
        }
    }
}
