package app.oddjob.crew.ui.room

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.oddjob.crew.data.RoomBrief
import app.oddjob.crew.data.RoomState
import app.oddjob.crew.data.WorkProduct
import app.oddjob.crew.ui.cards.CopyButton
import app.oddjob.crew.ui.markdown.MarkdownText
import kotlinx.coroutines.launch

/** Where a room stands, in the web workspace's words (CrewRoomWorkspace's roomProgress). */
internal fun roomProgress(room: RoomState, working: Boolean): String = when {
    room.session?.status == "archived" -> "Closed"
    working -> "Working"
    room.commitments.any { it.status == "blocked" } -> "Blocked"
    room.decisions.any { it.status == "proposed" } -> "Awaiting decision"
    room.workProducts.isNotEmpty() -> "Ready for review"
    else -> "Exploring"
}

/**
 * The room's standing brief and its deliverable: the mobile form of the web's
 * Room workspace panel. Saving goes through the same routes; asking the crew
 * posts the same request text.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun WorkspaceSheet(
    room: RoomState,
    working: Boolean,
    onSaveBrief: suspend (RoomBrief) -> String?,
    onSaveProduct: suspend (WorkProduct, String, String) -> String?,
    onRequest: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val session = room.session
    val brief = session?.memory?.roomBrief
    val products = remember(room.turns, room.workProductTurns) { room.workProducts }
    val disabled = session == null || session.status == "archived" || working
    var mode by rememberSaveable { mutableStateOf("view") } // view | brief | product
    var selectedKey by rememberSaveable { mutableStateOf<String?>(null) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var objective by rememberSaveable { mutableStateOf("") }
    var criteria by rememberSaveable { mutableStateOf("") }
    var constraints by rememberSaveable { mutableStateOf("") }
    var draft by rememberSaveable { mutableStateOf("") }
    var changeSummary by rememberSaveable { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    val selected = products.firstOrNull { it.versionKey == selectedKey } ?: products.lastOrNull()
    val versions = selected?.let { s -> products.filter { it.documentKey == s.documentKey } }.orEmpty()
    val versionNumber = versions.indexOfFirst { it.versionKey == selected?.versionKey } + 1
    val nextCommitment = room.commitments.firstOrNull { it.status in setOf("open", "in_progress", "blocked") }

    fun save(block: suspend () -> String?) {
        saving = true
        error = null
        scope.launch {
            val failure = block()
            saving = false
            if (failure == null) mode = "view" else error = failure
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.padding(horizontal = 16.dp).navigationBarsPadding().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Room workspace", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                Text(roomProgress(room, working), style = MaterialTheme.typography.labelMedium)
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }

            when (mode) {
                "brief" -> {
                    OutlinedTextField(objective, { objective = it }, label = { Text("Objective") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(criteria, { criteria = it }, label = { Text("Success criteria, one per line") }, minLines = 3, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(constraints, { constraints = it }, label = { Text("Scope constraints, one per line") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !disabled && !saving, onClick = {
                            RoomBrief.fromInput(objective, criteria, constraints)
                                .onSuccess { b -> save { onSaveBrief(b) } }
                                .onFailure { error = it.message }
                        }) { Text(if (saving) "Saving…" else "Save brief") }
                        TextButton(enabled = !saving, onClick = { mode = "view" }) { Text("Cancel") }
                    }
                }
                "product" -> if (selected != null) {
                    Text(selected.title, style = MaterialTheme.typography.titleMedium)
                    OutlinedTextField(draft, { if (it.length <= 50_000) draft = it }, label = { Text("Document content") }, minLines = 8, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(changeSummary, { if (it.length <= 1000) changeSummary = it }, label = { Text("What changed?") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !disabled && !saving && draft.isNotBlank() && changeSummary.isNotBlank(), onClick = {
                            save { onSaveProduct(selected, draft, changeSummary).also { if (it == null) selectedKey = null } }
                        }) { Text(if (saving) "Saving…" else "Save new version") }
                        TextButton(enabled = !saving, onClick = { mode = "view" }) { Text("Cancel") }
                    }
                }
                else -> {
                    Text("Objective", style = MaterialTheme.typography.labelLarge)
                    Text(brief?.objective ?: "Define the outcome this team should achieve.", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "Next step: " + (nextCommitment?.title ?: session?.nextSteps ?: "No next step recorded."),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (brief != null) {
                        Text("Success criteria", style = MaterialTheme.typography.labelLarge)
                        brief.successCriteria.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall) }
                        if (brief.constraints.isNotEmpty()) {
                            Text("Constraints: ${brief.constraints.joinToString(" · ")}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    } else {
                        Text("No success criteria recorded.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    OutlinedButton(enabled = !disabled, onClick = {
                        objective = brief?.objective.orEmpty()
                        criteria = brief?.successCriteria?.joinToString("\n").orEmpty()
                        constraints = brief?.constraints?.joinToString("\n").orEmpty()
                        error = null
                        mode = "brief"
                    }) { Text("Edit room brief") }

                    HorizontalDivider(Modifier.padding(vertical = 4.dp))
                    Text("Work product", style = MaterialTheme.typography.titleMedium)
                    if (selected == null) {
                        Text("The team's deliverable and its revisions will appear here.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        OutlinedButton(enabled = !disabled, onClick = {
                            onRequest("Create a room work product using publish_work_product from our current brief and available evidence. Identify missing information and unmet success criteria.")
                            onDismiss()
                        }) { Text("Create work product") }
                    } else {
                        // One chip per version, newest last, as the web's version picker lists them.
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            products.forEach { p ->
                                FilterChip(
                                    selected = p.versionKey == selected.versionKey,
                                    onClick = { selectedKey = p.versionKey },
                                    label = { Text("${p.title.take(24)} · turn ${p.turnId}") },
                                )
                            }
                        }
                        Text("${selected.title} · Version $versionNumber · ${selected.author}", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                        Text(
                            selected.changeSummary + (selected.sourceTurnId?.let { " · Revised from turn $it" } ?: ""),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            CopyButton(selected.content, "Copy work product")
                            OutlinedButton(enabled = !disabled, onClick = {
                                selectedKey = selected.versionKey
                                draft = selected.content
                                changeSummary = ""
                                error = null
                                mode = "product"
                            }) { Text("Edit") }
                            TextButton(enabled = !disabled, onClick = {
                                onRequest("Revise the work product \"${selected.title}\" (documentKey: ${selected.documentKey}, source turn: ${selected.turnId}) against the room success criteria. Preserve recorded user corrections, cite evidence, and publish a complete updated version with publish_work_product.")
                                onDismiss()
                            }) { Text("Ask CREW to revise") }
                        }
                        MarkdownText(selected.content)
                    }
                }
            }
            Text(
                "Tool success confirms execution, not independent verification.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 12.dp),
            )
        }
    }
}
