package app.oddjob.crew.ui.cards

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import app.oddjob.crew.data.GranolaMeeting
import app.oddjob.crew.data.GranolaPrivateResults
import app.oddjob.crew.data.PermissionRequired
import app.oddjob.crew.data.Reauthorization
import kotlinx.coroutines.launch

/** A refused call and the steps that would allow it, in order, with who can take them. */
@Composable
fun PermissionRequiredCard(card: PermissionRequired, resolveUrl: (String) -> String) {
    val uriHandler = LocalUriHandler.current
    CardSurface {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Lock, null, tint = MaterialTheme.colorScheme.tertiary, modifier = Modifier.size(18.dp))
                Text(card.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text("Not allowed", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.tertiary)
            }
            Text(card.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            card.steps.forEachIndexed { index, step ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(18.dp).background(
                            if (step.done) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                            CircleShape,
                        ),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (step.done) Icon(Icons.Default.Check, "Done", Modifier.size(12.dp), tint = MaterialTheme.colorScheme.primary)
                        else Text("${index + 1}", style = MaterialTheme.typography.labelSmall)
                    }
                    Text(
                        step.label,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (step.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                        textDecoration = if (step.done) TextDecoration.LineThrough else null,
                    )
                }
            }
            Text(card.footer, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val href = card.manageHref
            if (card.callerCanGrant && href != null && card.remaining.isNotEmpty()) {
                Button(onClick = { uriHandler.openUri(resolveUrl(href)) }) { Text("Open QuickBooks access") }
            }
        }
    }
}

/**
 * A private Granola search. The asker lists their own matches and can share one
 * into the room; everyone else sees only that the matches are private.
 */
@Composable
fun GranolaPrivateResultsCard(
    card: GranolaPrivateResults,
    viewerId: String?,
    loadMeetings: suspend (GranolaPrivateResults) -> Result<List<GranolaMeeting>>,
    share: suspend (GranolaPrivateResults, String) -> String?,
) {
    val owner = card.isOwner(viewerId)
    CardSurface {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Lock, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                Text(if (owner) "Your Granola meetings" else "Granola meetings", style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text(card.countLabel, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (!owner) {
                Muted("Only the person who asked can see which meetings matched. Their notes appear here only if they share them.")
                return@Column
            }
            Muted("Only you can see this list. Share a meeting to put its notes in this room, where everyone who can open the room can read them.")
            var meetings by remember(card) { mutableStateOf<Result<List<GranolaMeeting>>?>(null) }
            LaunchedEffect(card) { meetings = loadMeetings(card) }
            // Per meeting: "sharing", "shared", or why it could not be shared.
            val shared = remember(card) { mutableStateMapOf<String, String>() }
            val scope = rememberCoroutineScope()
            val list = meetings?.getOrNull()
            when {
                meetings == null -> Muted("Loading your meetings…")
                list == null -> Text("Your Granola meetings could not be loaded.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                list.isEmpty() -> Muted("No meetings matched.")
                else -> list.forEachIndexed { i, m ->
                    if (i > 0) HorizontalDivider()
                    val state = shared[m.id]
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(m.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                            m.meta.takeIf { it.isNotEmpty() }?.let { Muted(it) }
                            if (state != null && state != "sharing" && state != "shared") {
                                Text(state, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                            }
                        }
                        OutlinedButton(
                            enabled = state != "sharing" && state != "shared",
                            onClick = {
                                shared[m.id] = "sharing"
                                scope.launch { shared[m.id] = share(card, m.id) ?: "shared" }
                            },
                        ) { Text(when (state) { "shared" -> "Shared"; "sharing" -> "Sharing…"; else -> "Share" }) }
                    }
                }
            }
        }
    }
}

/**
 * Connections whose authorization expired and cannot be renewed. Reauthorizing
 * is an OAuth consent flow, so it opens on the Oddjob site in the browser.
 */
@Composable
fun ReauthorizeBanner(items: List<Reauthorization>, resolveUrl: (String) -> String) {
    if (items.isEmpty()) return
    val uriHandler = LocalUriHandler.current
    Surface(color = MaterialTheme.colorScheme.tertiaryContainer, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Authorization expired", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onTertiaryContainer)
            items.forEach { item ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("${item.label} · ${item.scopeNote}", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.onTertiaryContainer)
                        Text(
                            if (item.canReauthorize) item.reasonText else "${item.reasonText} Ask an organization admin to reauthorize ${item.label}.",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onTertiaryContainer,
                        )
                    }
                    val path = item.safePath
                    if (item.canReauthorize && path != null) {
                        OutlinedButton(onClick = { uriHandler.openUri(resolveUrl(path)) }) {
                            Text(if (item.opensDashboard) "Open connectors" else "Reauthorize")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Muted(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
