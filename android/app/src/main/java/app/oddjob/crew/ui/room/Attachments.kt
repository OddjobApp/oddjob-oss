package app.oddjob.crew.ui.room

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import app.oddjob.crew.data.CrewAttachment
import app.oddjob.crew.data.UploadFile
import app.oddjob.crew.ui.theme.OddjobIcons
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** The file types the web room accepts (CrewAttachmentBar's `accept`), as MIME types for the document picker. */
private val documentTypes = arrayOf(
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv", "text/plain", "text/markdown", "application/json", "application/xml", "text/xml",
    "application/x-yaml", "text/yaml",
    "image/*",
)

/** Why a picked file was not sent, or null when it can be. */
internal fun rejectReason(name: String, size: Long, maxBytes: Long): String? =
    if (size > maxBytes) "$name is larger than ${maxBytes / (1024 * 1024)} MB." else null

/** Reads picked content URIs into upload files, with their real names and types. */
private suspend fun readFiles(context: Context, uris: List<Uri>, maxBytes: Long): Pair<List<UploadFile>, List<String>> =
    withContext(Dispatchers.IO) {
        val files = mutableListOf<UploadFile>()
        val problems = mutableListOf<String>()
        for (uri in uris) {
            val resolver = context.contentResolver
            var name = uri.lastPathSegment ?: "file"
            var size = -1L
            runCatching {
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                    if (c.moveToFirst()) {
                        c.getString(0)?.let { name = it }
                        if (!c.isNull(1)) size = c.getLong(1)
                    }
                }
            }
            if (size >= 0) rejectReason(name, size, maxBytes)?.let { problems += it; continue }
            val bytes = runCatching { resolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
            if (bytes == null) { problems += "Couldn't read $name."; continue }
            rejectReason(name, bytes.size.toLong(), maxBytes)?.let { problems += it; continue }
            files += UploadFile(name, resolver.getType(uri) ?: "application/octet-stream", bytes)
        }
        files to problems
    }

/**
 * The composer's attach button: take a photo, pick photos, or pick documents.
 * Picked files go straight up to the room; the photo picker and document
 * picker need no storage permission, and the camera writes into the app cache
 * through a FileProvider, so no camera permission is requested either.
 */
@Composable
fun AttachButton(
    enabled: Boolean,
    maxFiles: Int,
    maxBytes: Long,
    onUpload: suspend (List<UploadFile>) -> String?,
    onMessage: (String) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var photoPath by rememberSaveable { mutableStateOf<String?>(null) }

    fun send(uris: List<Uri>) {
        if (uris.isEmpty()) return
        scope.launch {
            val chosen = uris.take(maxFiles)
            val (files, problems) = readFiles(context, chosen, maxBytes)
            val notes = problems.toMutableList()
            if (uris.size > maxFiles) notes += "Only the first $maxFiles files were attached."
            if (files.isNotEmpty()) onUpload(files)?.let { notes += it }
            if (notes.isNotEmpty()) onMessage(notes.joinToString(" "))
        }
    }

    val takePhoto = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val path = photoPath
        photoPath = null
        if (saved && path != null) {
            val file = File(path)
            send(listOf(FileProvider.getUriForFile(context, "${context.packageName}.files", file)))
        }
    }
    val pickPhotos = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(maxFiles)) { send(it) }
    val pickDocuments = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { send(it) }

    Box {
        IconButton(onClick = { open = true }, enabled = enabled) {
            Icon(OddjobIcons.Paperclip, "Attach a file or photo", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("Take photo") }, onClick = {
                open = false
                val dir = File(context.cacheDir, "camera").apply { mkdirs() }
                // Old captures are not kept: each one is uploaded, then only the room holds it.
                dir.listFiles()?.forEach { it.delete() }
                val file = File(dir, "photo-${System.currentTimeMillis()}.jpg")
                photoPath = file.absolutePath
                takePhoto.launch(FileProvider.getUriForFile(context, "${context.packageName}.files", file))
            })
            DropdownMenuItem(text = { Text("Choose photos") }, onClick = {
                open = false
                pickPhotos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            })
            DropdownMenuItem(text = { Text("Choose document") }, onClick = {
                open = false
                pickDocuments.launch(documentTypes)
            })
        }
    }
}

/**
 * The room's files above the composer, newest first, saying which could not be
 * read. [onRemove] detaches one, so the room's agents stop searching it.
 */
@Composable
fun AttachmentBar(
    attachments: List<CrewAttachment>,
    uploading: Boolean,
    removingId: Int? = null,
    enabled: Boolean = true,
    onRemove: ((CrewAttachment) -> Unit)? = null,
) {
    if (attachments.isEmpty() && !uploading) return
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (uploading) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                Text("Uploading and reading…", style = MaterialTheme.typography.labelSmall)
            }
        }
        attachments.forEach { a ->
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = if (a.readable || a.parseStatus == "pending") MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.errorContainer,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.padding(start = 8.dp, end = if (onRemove == null) 8.dp else 0.dp, top = 4.dp, bottom = 4.dp).widthIn(max = 200.dp)) {
                    Text(
                        (if (a.parseType == "image" || a.mimeType?.startsWith("image/") == true) "🖼 " else "📄 ") + a.displayName,
                        style = MaterialTheme.typography.labelMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        listOf(readableSize(a.byteSize), statusLabel(a)).joinToString(" · "),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (onRemove != null) {
                    if (removingId == a.id) {
                        CircularProgressIndicator(Modifier.padding(horizontal = 10.dp).size(14.dp), strokeWidth = 2.dp)
                    } else {
                        IconButton(
                            onClick = { onRemove(a) },
                            enabled = enabled && removingId == null,
                            modifier = Modifier.size(32.dp),
                        ) { Icon(Icons.Default.Close, "Remove ${a.displayName} from this room", Modifier.size(16.dp)) }
                    }
                }
                }
            }
        }
    }
}

internal fun readableSize(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${Math.round(bytes / 1024.0)} KB"
    else -> "%.1f MB".format(bytes / (1024.0 * 1024.0))
}

/** In the web bar's words: readable, still being read, or why not. */
internal fun statusLabel(a: CrewAttachment): String = when (a.parseStatus) {
    "parsed" -> if (a.indexStatus == "indexed") "ready" else "reading…"
    "pending" -> "reading…"
    else -> "couldn't read (${a.parseStatus})"
}
