package app.oddjob.crew.ui.cards

import android.content.ClipData
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import app.oddjob.crew.data.Links
import coil3.compose.AsyncImage
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.oddjob.crew.data.Carousel
import app.oddjob.crew.data.CrewReview
import app.oddjob.crew.data.CrewText
import app.oddjob.crew.data.GmailDirective
import app.oddjob.crew.data.GovernanceCheckpoint
import app.oddjob.crew.data.RecordCard
import app.oddjob.crew.data.Workspace
import app.oddjob.crew.data.WorkspaceAction
import app.oddjob.crew.data.WorkspaceItem
import app.oddjob.crew.data.WorkspaceResults
import app.oddjob.crew.data.WorkspaceSelection
import app.oddjob.crew.ui.theme.WorkspaceIcon
import app.oddjob.crew.ui.theme.WorkspaceIcons
import kotlinx.coroutines.launch

/** Copies [text] to the clipboard: the web's per-turn and per-card copy buttons. */
@Composable
fun CopyButton(text: String, description: String = "Copy") {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    IconButton(
        onClick = { scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(description, text))) } },
        modifier = Modifier.size(32.dp),
    ) {
        Icon(WorkspaceIcons.Copy, description, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Muted(text: String, maxLines: Int = Int.MAX_VALUE) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun Fact(label: String, value: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun StatusTag(text: String, alert: Boolean = false) {
    Surface(
        shape = MaterialTheme.shapes.small,
        color = if (alert) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            color = if (alert) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

// ---- Workspace results ----------------------------------------------------

/**
 * Gmail, Calendar, Drive, Microsoft 365, YouTube, Amazon and FlightHub results.
 * Tapping an item makes it chat context; its buttons put a request in the
 * composer for the person to send, as on the web.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WorkspaceResultCard(
    results: WorkspaceResults,
    turnId: Int,
    tool: String,
    resultIndex: Int,
    selected: List<WorkspaceSelection>,
    enabled: Boolean,
    onSelect: (List<WorkspaceSelection>) -> Unit,
    onAct: (List<WorkspaceSelection>, WorkspaceAction) -> Unit,
    onMore: (String) -> Unit,
    saveSnapshot: suspend (String, String, Int?) -> String? = { _, _, _ -> "unavailable" },
) {
    val uriHandler = LocalUriHandler.current
    val refs = results.items.map { WorkspaceSelection(turnId, tool, resultIndex, it) }
    val chosen = refs.filter { r -> selected.any(r::sameSlot) }
    // A lone result opens with its content shown, as on the web, except an email: those load collapsed and are expanded to read.
    var expanded by rememberSaveable("ws-$turnId-$tool-$resultIndex") {
        mutableStateOf(results.items.singleOrNull()?.takeIf { it.kind != "email" }?.id)
    }
    val first = results.items.firstOrNull()

    CardSurface {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            WorkspaceIcon(first?.kind ?: kindFromTool(results.sourceTool), first?.platform)
            Text(results.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Muted("${results.items.size} ${if (results.items.size == 1) "item" else "items"}")
            CopyButton(Workspace.copyText(results), "Copy card")
        }
        if (refs.size > 1) {
            TextButton(onClick = { onSelect(if (chosen.size == refs.size) emptyList() else refs) }, enabled = enabled) {
                Text(if (chosen.size == refs.size) "Clear list selection" else "Select all")
            }
        }
        if (refs.isEmpty()) Muted("No items returned for this query.")
        results.readCharacters?.let {
            Muted("%,d characters read · %s".format(it, if (results.complete == true) "End of document reached" else "Partial read — more text remains"))
        }
        refs.forEachIndexed { index, ref ->
            val item = ref.item
            val active = chosen.any(ref::sameSlot)
            if (index > 0) HorizontalDivider(Modifier.padding(vertical = 6.dp))
            Surface(
                color = if (active) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f) else MaterialTheme.colorScheme.surface,
                shape = MaterialTheme.shapes.small,
                modifier = Modifier.fillMaxWidth().clickable(enabled = enabled) {
                    onSelect(if (active) chosen.filterNot(ref::sameSlot) else chosen + ref)
                },
            ) {
                Column(Modifier.padding(6.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    WorkspaceItemBody(item, saveSnapshot)
                    if (expanded == item.id && item.body != null) {
                        Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth()) {
                            Text(
                                item.body,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.heightIn(max = 280.dp).verticalScroll(rememberScrollState()).padding(8.dp),
                            )
                        }
                        Muted("Content preview. Discuss reads the live source for full context.")
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (item.kind == "email") TextButton(enabled = enabled, onClick = { onAct(listOf(ref), WorkspaceAction.SUMMARIZE) }) { Text("Summarize") }
                        if (item.body != null) TextButton(onClick = { expanded = if (expanded == item.id) null else item.id }) {
                            Text(if (expanded == item.id) "Hide content" else "Preview content")
                        }
                        TextButton(enabled = enabled, onClick = { onAct(listOf(ref), WorkspaceAction.DISCUSS) }) { Text("Discuss") }
                        TextButton(enabled = enabled, onClick = { onAct(listOf(ref), WorkspaceAction.RESPOND) }) { Text(Workspace.respondLabel(item)) }
                        Workspace.openLink(item)?.let { (label, url) -> TextButton(onClick = { uriHandler.openUri(url) }) { Text(label) } }
                        if (item.platform == "amazon" && Links.isAmazon(item.cartUrl)) {
                            TextButton(onClick = { uriHandler.openUri(item.cartUrl!!) }) { Text("Add to Amazon cart") }
                        }
                    }
                    if (active) Text("✓ Chat context", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                }
            }
        }
        if (chosen.size > 1) {
            HorizontalDivider(Modifier.padding(vertical = 6.dp))
            Muted("${chosen.size} selected")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (chosen.all { it.item.kind == "email" }) OutlinedButton(enabled = enabled, onClick = { onAct(chosen, WorkspaceAction.SUMMARIZE) }) { Text("Summarize selected") }
                OutlinedButton(enabled = enabled, onClick = { onAct(chosen, WorkspaceAction.DISCUSS) }) { Text("Discuss selected") }
                Button(enabled = enabled, onClick = { onAct(chosen, WorkspaceAction.RESPOND) }) { Text("Prepare responses") }
            }
        }
        Workspace.moreMessage(results)?.let { message ->
            TextButton(enabled = enabled, onClick = { onMore(message) }) { Text("Load more") }
        }
    }
}

private fun kindFromTool(tool: String) = when {
    tool.startsWith("gmail") -> "email"
    tool.startsWith("gcal") -> "calendar"
    else -> "document"
}

/** A video or playlist still, 16:9, with the web card's duration, video-count and CC badges. Tapping opens it. */
@Composable
private fun VideoThumbnail(url: String, item: WorkspaceItem, onOpen: (() -> Unit)?) {
    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(16f / 9f)
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .then(if (onOpen != null) Modifier.clickable(onClick = onOpen) else Modifier),
    ) {
        AsyncImage(model = url, contentDescription = item.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        if (item.hasCaptions == true) ThumbBadge("CC", Modifier.align(Alignment.TopStart))
        val corner = when {
            item.youtubeKind == "playlist" && item.itemCount != null -> "${compact(item.itemCount)} videos"
            item.duration != null -> formatDuration(item.duration)
            else -> null
        }
        corner?.let { ThumbBadge(it, Modifier.align(Alignment.BottomEnd)) }
    }
}

@Composable
private fun ThumbBadge(text: String, modifier: Modifier) {
    // Fixed colours: the badge sits on a video still, not on the theme.
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = Color.White,
        modifier = modifier.padding(6.dp).background(Color.Black.copy(alpha = 0.8f), RoundedCornerShape(3.dp)).padding(horizontal = 4.dp, vertical = 1.dp),
    )
}

/** h:mm:ss or m:ss, as the web formats a video length. */
internal fun formatDuration(seconds: Double): String {
    val total = Math.round(seconds)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

@Composable
private fun WorkspaceItemBody(item: WorkspaceItem, saveSnapshot: suspend (String, String, Int?) -> String?) {
    val uriHandler = LocalUriHandler.current
    when (item.platform) {
        "quickbooks" -> QuickBooksItemBody(item, saveSnapshot)
        "amazon" -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          Links.thumbnail(item)?.let { url ->
            // Transparent product PNGs assume a white tile, as on the web.
            Box(
                Modifier.size(88.dp).clip(RoundedCornerShape(6.dp)).background(Color.White).padding(4.dp),
                contentAlignment = Alignment.Center,
            ) { AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize()) }
          }
          Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(item.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            listOfNotNull(item.brand, item.asin).takeIf { it.isNotEmpty() }?.let { Muted(it.joinToString(" · "), 1) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                item.priceDisplay?.let { Text(it, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold) }
                item.listPriceDisplay?.takeIf { it != item.priceDisplay }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall.copy(textDecoration = TextDecoration.LineThrough), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (item.isPrime == true) StatusTag("Prime")
            }
            listOfNotNull(
                item.rating?.let { "★ %.1f".format(it) + (item.reviewCount?.let { n -> " (${compact(n)})" } ?: "") },
                item.availability,
            ).takeIf { it.isNotEmpty() }?.let { Muted(it.joinToString(" · ")) }
            item.preview?.let { Muted(it, 2) }
          }
        }
        "flighthub" -> {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                WorkspaceIcon("flight", "flighthub")
                Text(
                    listOfNotNull(item.originCode, item.destinationCode).joinToString(" → ").ifEmpty { item.title },
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                item.priceDisplay?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold) }
            }
            (listOfNotNull(item.airlineName, item.flightNumbers.takeIf { it.isNotEmpty() }?.joinToString(", ")).joinToString(" · ").ifEmpty { item.sender })?.let { Muted(it, 1) }
            listOfNotNull(
                if (item.departAt != null && item.arriveAt != null) "${item.departAt} → ${item.arriveAt}" else item.departAt ?: item.arriveAt,
                item.durationDisplay, item.stopsDisplay, item.cabinClass,
            ).takeIf { it.isNotEmpty() }?.let { Muted(it.joinToString(" · ")) }
            if (item.departAt == null) item.preview?.let { Muted(it, 2) }
        }
        "youtube" -> {
            val thumb = Links.thumbnail(item)
            val open = Workspace.openLink(item)?.second
            if (item.youtubeKind == "channel") {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (thumb != null) {
                        AsyncImage(model = thumb, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(52.dp).clip(CircleShape))
                    } else {
                        WorkspaceIcon(item.kind, "youtube", size = 28.dp)
                    }
                    Text(item.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            } else {
                if (thumb != null) VideoThumbnail(thumb, item, onOpen = open?.let { url -> { uriHandler.openUri(url) } })
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    WorkspaceIcon(item.kind, "youtube")
                    Text(item.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            when (item.youtubeKind) {
                "channel" -> listOfNotNull(
                    item.customUrl,
                    item.subscriberCount?.let { "${compact(it)} subscribers" },
                    item.videoCount?.let { "${compact(it)} videos" },
                    item.viewCount?.let { "${compact(it)} views" },
                ).takeIf { it.isNotEmpty() }?.let { Muted(it.joinToString(" · ")) }
                "playlist" -> listOfNotNull(item.sender, item.itemCount?.let { "${compact(it)} videos" }).takeIf { it.isNotEmpty() }?.let { Muted(it.joinToString(" · ")) }
                else -> listOfNotNull(item.sender, item.viewCount?.let { "${compact(it)} views" }, item.date?.take(10)).takeIf { it.isNotEmpty() }?.let { Muted(it.joinToString(" · ")) }
            }
            item.preview?.let { Muted(it, 3) }
        }
        else -> {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                WorkspaceIcon(item.kind, item.platform, size = 16.dp)
                Text(item.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            }
            item.sender?.let { Muted(it) }
            item.recipient?.let { Muted("To: $it") }
            if (item.attachments.isNotEmpty()) Muted("Attachments: ${item.attachments.joinToString(", ")}")
            Workspace.whenLine(item)?.let { Muted(it) }
            item.location?.let { Muted(it) }
            item.preview?.let { Muted(if (item.kind == "email") "Email preview: $it" else it, 3) }
        }
    }
}

private fun compact(n: Long): String = when {
    n >= 1_000_000_000 -> "%.1fB".format(n / 1e9)
    n >= 1_000_000 -> "%.1fM".format(n / 1e6)
    n >= 1_000 -> "%.1fK".format(n / 1e3)
    else -> n.toString()
}.replace(".0", "")

// ---- Reviews -------------------------------------------------------------

@Composable
fun ReviewCard(review: CrewReview) {
    var showEvidence by rememberSaveable(review.title) { mutableStateOf(false) }
    CardSurface {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(review.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                StatusTag(review.status, alert = review.status == "Blocked")
            }
            Text(review.summary, style = MaterialTheme.typography.bodyMedium)
            Muted("${review.period} · Methodology: ${review.methodologyVersion}")
            Text(
                (review.score?.let { "%.1f / 100".format(it) } ?: "Score pending") + " · ${review.assessed}/${review.criteria.size} dimensions assessed",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
            )
            Muted("Recommendation only. Approval and execution are recorded separately.")
            review.criteria.forEach { c ->
                Row {
                    Text(c.label, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                    Text(c.score?.let { "${it.toInt()}/100" } ?: "Not assessed", style = MaterialTheme.typography.bodySmall)
                }
                c.score?.let { LinearProgressIndicator(progress = { (it / 100).toFloat() }, modifier = Modifier.fillMaxWidth()) }
            }
            if (review.gates.isNotEmpty()) {
                Text("Mandatory criteria", style = MaterialTheme.typography.labelLarge)
                review.gates.forEach { g ->
                    Text(
                        "${when (g.status) { "pass" -> "Pass"; "fail" -> "Blocked"; else -> "Unverified" }} — ${g.label}",
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Medium,
                    )
                    Muted(g.evidence)
                }
            }
            if (review.actions.isNotEmpty()) {
                Text("Recommended next steps", style = MaterialTheme.typography.labelLarge)
                review.actions.forEach { a ->
                    Text(a.description, style = MaterialTheme.typography.bodySmall)
                    listOfNotNull(a.owner?.let { "Owner: $it" }, a.due?.let { "Due: $it" }).takeIf { it.isNotEmpty() }?.let { Muted(it.joinToString(" · ")) }
                }
            }
            TextButton(onClick = { showEvidence = !showEvidence }) { Text(if (showEvidence) "Hide evidence" else "Evidence and scoring method") }
            if (showEvidence) {
                review.criteria.forEach { c ->
                    Text("${c.label} · Relative weight ${c.weight.let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString() }}", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                    Muted(c.evidence)
                }
                Muted("Weighted mean of assessed dimensions, published only when every dimension is assessed. Failed mandatory criteria override readiness.")
            }
        }
    }
}

// ---- Decisions, claims and commitments --------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RecordCardView(card: RecordCard, stateKey: String, enabled: Boolean, onChange: suspend (RecordCard, String) -> String?) {
    var status by rememberSaveable(stateKey) { mutableStateOf(card.status) }
    var busy by rememberSaveable(stateKey) { mutableStateOf(false) }
    var error by rememberSaveable(stateKey) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val current = card.copy(status = status)
    CardSurface {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when (card.kind) { "decisions" -> "DECISION"; "claims" -> "CLAIM"; else -> "COMMITMENT" },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.tertiary,
                    modifier = Modifier.weight(1f),
                )
                StatusTag(status.replace('_', ' '), alert = status in setOf("rejected", "refuted", "blocked"))
            }
            Text(card.text, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            card.detail?.let { Muted(it) }
            card.confidence?.let { Muted("Confidence $it%") }
            card.extra.forEach { (label, value) -> Fact(label, value) }
            card.createdBy?.let { Muted("${if (card.kind == "claims") "Claimed" else "Proposed"} by $it") }
            error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
            val actions = current.actions
            if (actions.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    actions.forEachIndexed { i, (next, label) ->
                        val onClick: () -> Unit = {
                            busy = true
                            error = null
                            scope.launch {
                                val failure = onChange(current, next)
                                if (failure == null) status = next else error = failure
                                busy = false
                            }
                        }
                        if (i == 0) Button(onClick = onClick, enabled = enabled && !busy) { Text(label) }
                        else OutlinedButton(onClick = onClick, enabled = enabled && !busy) { Text(label) }
                    }
                }
            }
        }
    }
}

@Composable
fun GovernanceCard(checkpoint: GovernanceCheckpoint) {
    val critical = checkpoint.riskTier == "critical" || checkpoint.riskTier == "high"
    CardSurface {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("GOVERNANCE CHECKPOINT", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.tertiary, modifier = Modifier.weight(1f))
                checkpoint.riskTier?.let { StatusTag("$it risk", alert = critical) }
            }
            Text(checkpoint.actionTitle, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            checkpoint.summary?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            checkpoint.facts.forEach { (label, value) -> Fact(label, value) }
            checkpoint.requestedBy?.let { Muted("Requested by $it · ${checkpoint.status}") }
            Muted("Informational. Nothing is authorized from this card; approvals that gate execution appear as approval requests.")
        }
    }
}

// ---- Gmail directives ----------------------------------------------------

@Composable
fun GmailDirectiveCard(directive: GmailDirective, enabled: Boolean, onCommand: (String) -> Unit) {
    CardSurface {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                WorkspaceIcon("email")
                Text("Gmail sender alert", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                StatusTag(directive.statusLabel)
            }
            Text("From: ${directive.sender}", style = MaterialTheme.typography.bodyMedium)
            directive.mailbox?.let { Muted("Connected mailbox: $it") }
            Muted("Checks every ${directive.intervalSeconds ?: "?"} seconds · No recurring AI calls · Notifications enabled when active")
            Muted("Alerts also reach this phone when its notifications are on (Settings).")
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                val removed = directive.status == "removed"
                OutlinedButton(enabled = enabled && !removed, onClick = { onCommand(GmailDirective.toggleCommand(directive)) }) {
                    Text(if (directive.status == "paused") "Resume" else "Pause")
                }
                TextButton(enabled = enabled, onClick = { onCommand(GmailDirective.statusCommand(directive)) }) { Text("Status") }
                TextButton(enabled = enabled && !removed, onClick = { onCommand(GmailDirective.removeCommand(directive)) }) { Text("Remove") }
            }
        }
    }
}

@Composable
fun GmailDirectiveListCard(directives: List<GmailDirective>, enabled: Boolean, onCommand: (String) -> Unit) {
    CardSurface {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                WorkspaceIcon("email")
                Text("Your Gmail directives", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }
            if (directives.isEmpty()) Muted("No directives saved in this project.")
            directives.forEach { d ->
                HorizontalDivider(Modifier.padding(vertical = 4.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(d.sender, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    StatusTag(d.statusLabel)
                }
                Muted("Last checked: ${d.lastCheckedAt ?: "Not yet"}")
                d.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    OutlinedButton(enabled = enabled, onClick = { onCommand(GmailDirective.toggleCommand(d)) }) { Text(if (d.status == "paused") "Resume" else "Pause") }
                    TextButton(enabled = enabled, onClick = { onCommand(GmailDirective.removeCommand(d)) }) { Text("Remove") }
                }
            }
        }
    }
}

// ---- Carousels and the rest ------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CarouselCard(carousel: Carousel, resolveUrl: (String) -> String) {
    val uriHandler = LocalUriHandler.current
    CardSurface {
        carousel.title?.let { Text(it, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold) }
        carousel.description?.let { Muted(it) }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            items(carousel.items) { item ->
                Surface(
                    shape = MaterialTheme.shapes.small,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier.width(220.dp),
                ) {
                    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Row(verticalAlignment = Alignment.Top) {
                            Text(item.title, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            item.badge?.let { StatusTag(it.uppercase()) }
                        }
                        item.subtitle?.let { Text(it, style = MaterialTheme.typography.labelSmall) }
                        item.description?.let { Muted(it, 3) }
                        item.meta.forEach { (label, value) -> Fact(label, value) }
                        if (item.tags.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) { item.tags.forEach { StatusTag(it) } }
                        if (item.ctaLabel != null && item.ctaHref != null) {
                            TextButton(onClick = { uriHandler.openUri(resolveUrl(item.ctaHref)) }) { Text("${item.ctaLabel} →") }
                        }
                    }
                }
            }
        }
    }
}

/** A work-product version's notice in the transcript; the document itself opens in the room's Brief & work sheet. */
@Composable
fun WorkProductNote(title: String, changeSummary: String?, onOpen: () -> Unit) {
    CardSurface {
        Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
        Muted(changeSummary ?: "A work product version was added to the room workspace.")
        TextButton(onClick = onOpen) { Text("Open work product") }
    }
}

/** A supervisor turn that is really a model-provider failure, as an action card instead of a raw error. */
@Composable
fun ProviderErrorCard(error: CrewText.ProviderError) {
    Surface(
        shape = MaterialTheme.shapes.medium,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.4f)),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(error.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                StatusTag("Action needed", alert = true)
            }
            Muted(error.message)
            HorizontalDivider()
            Text("Next step: ${error.nextStep}", style = MaterialTheme.typography.bodySmall)
        }
    }
}
