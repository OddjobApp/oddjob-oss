package app.oddjob.crew.ui.room

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.oddjob.crew.data.AgentCard
import app.oddjob.crew.data.CrewEnums
import app.oddjob.crew.data.RoomState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MembersSheet(
    members: List<AgentCard>,
    available: List<AgentCard>?,
    roomExists: Boolean,
    onLoad: () -> Unit,
    onSave: (List<Int>) -> Unit,
    onDismiss: () -> Unit,
) {
    LaunchedEffect(Unit) { onLoad() }
    var selected by remember(members) { mutableStateOf(members.map { it.id }.toSet()) }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 16.dp).navigationBarsPadding()) {
            Text("Crew", style = MaterialTheme.typography.titleLarge)
            Text(
                if (roomExists) "Choose which agents answer you in this room. Your choice is saved for this room."
                else "Pick agents before your first message. With none picked, the server seats three enabled agents.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (available == null) {
                Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            } else {
                LazyColumn(Modifier.heightIn(max = 420.dp)) {
                    items(available, key = { it.id }) { card ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable { selected = if (card.id in selected) selected - card.id else selected + card.id }
                                .padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(checked = card.id in selected, onCheckedChange = null)
                            Column(Modifier.padding(start = 8.dp)) {
                                Text(card.name, style = MaterialTheme.typography.bodyLarge)
                                card.description?.let {
                                    Text(
                                        it,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                Button(
                    enabled = available != null && selected.isNotEmpty(),
                    onClick = {
                        onSave(selected.toList())
                        onDismiss()
                    },
                ) { Text("Save") }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModeSheet(current: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(16.dp).navigationBarsPadding()) {
            Text("Room mode", style = MaterialTheme.typography.titleLarge)
            CrewEnums.roomModes.forEach { mode ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable {
                            onPick(mode)
                            onDismiss()
                        }
                        .padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = mode == current, onClick = null)
                    Text(mode.replaceFirstChar { it.uppercase() }, Modifier.padding(start = 8.dp))
                }
            }
        }
    }
}

private data class RecordTab(val kind: String, val label: String, val statuses: List<String>, val placeholder: String)

private val recordTabs = listOf(
    RecordTab("decisions", "Decisions", CrewEnums.decisionStatuses, "Record a decision"),
    RecordTab("claims", "Claims", CrewEnums.claimStatuses, "Record a claim"),
    RecordTab("commitments", "Commitments", CrewEnums.commitmentStatuses, "Record a commitment"),
)

/** Decisions, claims and commitments: the room's durable state, as opposed to its speech. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecordsSheet(
    room: RoomState,
    onCreate: (kind: String, text: String) -> Unit,
    onUpdate: (kind: String, id: Int, status: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var tab by rememberSaveable { mutableStateOf(0) }
    val current = recordTabs[tab]
    val rows: List<Triple<Int, String, String>> = when (current.kind) {
        "decisions" -> room.decisions.map { Triple(it.id, it.statement, it.status) }
        "claims" -> room.claims.map { Triple(it.id, it.claim, it.status) }
        else -> room.commitments.map { Triple(it.id, it.title, it.status) }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.navigationBarsPadding()) {
            PrimaryTabRow(selectedTabIndex = tab) {
                recordTabs.forEachIndexed { i, t ->
                    Tab(selected = tab == i, onClick = { tab = i }, text = { Text(t.label) })
                }
            }
            if (room.session == null) {
                Text(
                    "Records attach to a room once it has started. Send a message first.",
                    Modifier.padding(16.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                return@Column
            }
            LazyColumn(Modifier.heightIn(max = 380.dp)) {
                if (rows.isEmpty()) {
                    item {
                        Text(
                            "Nothing recorded yet.",
                            Modifier.padding(16.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                items(rows, key = { it.first }) { (id, text, status) ->
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(text, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        StatusPicker(status, current.statuses) { onUpdate(current.kind, id, it) }
                    }
                    HorizontalDivider()
                }
            }
            var draft by rememberSaveable(tab) { mutableStateOf("") }
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    placeholder = { Text(current.placeholder) },
                    modifier = Modifier.weight(1f),
                )
                TextButton(
                    enabled = draft.isNotBlank(),
                    onClick = {
                        onCreate(current.kind, draft)
                        draft = ""
                    },
                ) { Text("Add") }
            }
        }
    }
}

@Composable
private fun StatusPicker(status: String, options: List<String>, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        AssistChip(onClick = { open = true }, label = { Text(status.replace('_', ' ')) })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.replace('_', ' ')) },
                    onClick = {
                        open = false
                        if (option != status) onPick(option)
                    },
                )
            }
        }
    }
}
