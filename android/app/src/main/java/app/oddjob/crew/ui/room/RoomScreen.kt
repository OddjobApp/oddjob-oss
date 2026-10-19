package app.oddjob.crew.ui.room

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.lifecycle.compose.LifecycleStartEffect
import app.oddjob.crew.data.AgentPills
import app.oddjob.crew.ui.pills.AgentPillPicker
import app.oddjob.crew.ui.pills.SquadBar
import app.oddjob.crew.ui.pills.SquadSheet
import androidx.compose.material3.HorizontalDivider
import app.oddjob.crew.data.CrewSession
import app.oddjob.crew.data.WorkspaceSelection
import app.oddjob.crew.ui.cards.ReauthorizeBanner
import kotlinx.coroutines.launch
import app.oddjob.crew.ui.cards.TurnCardActions
import app.oddjob.crew.ui.theme.WorkspaceIcon
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.InputChip

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomScreen(
    viewModel: RoomViewModel,
    state: RoomUiState,
    serverUrl: String,
    showTurnDetails: Boolean,
    mapLocation: app.oddjob.crew.ui.cards.MapLocationPrefs,
    /** The Gmail alert event this room was opened for, from a directive push. */
    gmailAlert: Int? = null,
    onBack: () -> Unit,
) {
    val room = state.room
    val session = room.session
    val uriHandler = LocalUriHandler.current
    val snackbar = remember { SnackbarHostState() }
    val listState = rememberLazyListState()
    var draft by rememberSaveable(stateSaver = TextFieldValue.Saver) { mutableStateOf(TextFieldValue("")) }
    // The picker offers the org's agents minus studio crews, as the mobile app has no studios.
    val pillAgents = remember(state.availableCards) {
        state.availableCards.orEmpty().filterNot(AgentPills::isStudioAgent)
    }
    val mention = remember(draft, pillAgents) { AgentPills.detect(draft.text, draft.selection.start, pillAgents) }
    val memberNames = remember(room.members) { room.members.map { it.name } }
    // The agents that answer this person: the squad sheet's checkboxes.
    val selection = remember(state.selectedAgentIds, room, state.availableCards, state.draftMemberIds) {
        if (session == null) state.draftMemberIds ?: room.members.map { it.id }
        else app.oddjob.crew.data.AgentSelection.resolve(state.selectedAgentIds, room, state.availableCards)
    }
    val squad = remember(room, state.availableCards, selection) {
        app.oddjob.crew.data.AgentSelection.pool(room, state.availableCards, selection)
    }
    var menuOpen by remember { mutableStateOf(false) }
    var sheet by rememberSaveable { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(notice) { notice?.let { snackbar.showSnackbar(it); notice = null } }
    // The room's files, once the room exists.
    LaunchedEffect(session?.sessionKey) { if (session != null) viewModel.loadAttachments() }
    // A failed turn may be an authorization that expired, so the banner is re-read after an error.
    LaunchedEffect(session?.sessionKey, state.error) { if (session != null) viewModel.loadReauthorizations() }

    // The stream is held only while the screen is visible, so a backgrounded
    // app is not one of the room's live connections.
    LifecycleStartEffect(viewModel) {
        viewModel.startStream()
        onStopOrDispose { viewModel.stopStream() }
    }

    // A card action (Discuss, Draft reply…) proposes text; the person reviews and sends it.
    LaunchedEffect(state.composerPrefill) {
        state.composerPrefill?.let {
            draft = TextFieldValue(it, TextRange(it.length))
            viewModel.consumePrefill()
        }
    }

    // The alert's email is loaded once the room itself has loaded.
    LaunchedEffect(gmailAlert, session?.sessionKey) {
        if (gmailAlert != null && session != null) viewModel.openAlert(gmailAlert)
    }

    LaunchedEffect(state.error) {
        state.error?.let {
            snackbar.showSnackbar(it)
            viewModel.dismissError()
        }
    }

    // A form whose submission message already appears below it shows as submitted, on any device.
    val userTurns = remember(room.turns) {
        room.turns.filter { it.speakerType == "user" }.map { it.id to it.content }
    }

    val itemCount = room.turns.size + (if (state.pendingMessage != null) 1 else 0)
    LaunchedEffect(itemCount) {
        if (itemCount > 0) listState.animateScrollToItem(itemCount - 1)
    }

    val resolveUrl: (String) -> String = { url -> if (url.startsWith("/")) serverUrl.trimEnd('/') + url else url }
    val openInWeb = { uriHandler.openUri(viewModel.webUrl()) }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                },
                title = {
                    Column {
                        Text(
                            session?.title ?: session?.activeTopic ?: if (session == null) "New room" else "CREW room",
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Box(
                                Modifier
                                    .size(8.dp)
                                    .background(if (state.streamConnected) Color(0xFF43A047) else Color(0xFF9E9E9E), CircleShape)
                            )
                            Text(
                                buildString {
                                    append(
                                        when {
                                            state.fromCache -> "Saved copy · connecting"
                                            state.streamConnected -> "Live"
                                            else -> "Reconnecting"
                                        },
                                    )
                                    session?.let { append(" · ${it.mode}") }
                                    val agents = squad.count { it.id in selection }
                                    if (agents > 0) append(" · $agents ${if (agents == 1) "agent" else "agents"}")
                                },
                                style = MaterialTheme.typography.labelSmall,
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { sheet = "members" }) { Icon(Icons.Default.Person, "Crew") }
                    IconButton(onClick = { sheet = "records" }) { Icon(Icons.AutoMirrored.Filled.List, "Records") }
                    Box {
                        IconButton(onClick = { menuOpen = true }) { Icon(Icons.Default.MoreVert, "More") }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            if (session != null) {
                                DropdownMenuItem(text = { Text("Room mode") }, onClick = { menuOpen = false; sheet = "mode" })
                            }
                            if (session != null) {
                                DropdownMenuItem(text = { Text("Brief & work product") }, onClick = { menuOpen = false; sheet = "workspace" })
                            }
                            if (session?.status == "active") {
                                DropdownMenuItem(text = { Text("Share my location") }, onClick = { menuOpen = false; sheet = "beacon" })
                            }
                            if (session != null) {
                                DropdownMenuItem(text = { Text("Capabilities") }, onClick = { menuOpen = false; sheet = "readiness" })
                            }
                            DropdownMenuItem(text = { Text("Open in Oddjob web") }, onClick = { menuOpen = false; openInWeb() })
                            DropdownMenuItem(text = { Text("Refresh") }, onClick = { menuOpen = false; viewModel.refresh(full = true) })
                            if (session?.status == "active") {
                                DropdownMenuItem(text = { Text("Conclude meeting") }, onClick = { menuOpen = false; sheet = "conclude" })
                            }
                        }
                    }
                },
            )
        },
        bottomBar = {
            // Nav-bar inset first, so the IME inset only adds what the keyboard covers beyond it.
            Column(Modifier.navigationBarsPadding().imePadding()) {
                if (state.roundActive) RoundBar(sending = state.sending, onStop = viewModel::cancelRound)
                if (session?.status == "archived") {
                    ArchivedBar(onReopen = viewModel::reopen)
                } else {
                    mention?.let { m ->
                        val matches = AgentPills.matches(m, pillAgents)
                        if (matches.isNotEmpty()) {
                            AgentPillPicker(matches) { agent ->
                                val (text, caret) = AgentPills.insert(draft.text, m, agent)
                                draft = TextFieldValue(text, TextRange(caret))
                            }
                        }
                    }
                    state.alert?.let { AlertBanner(it, onRetry = { viewModel.openAlert(it.eventId) }, onDismiss = viewModel::dismissAlert) }
                    if (state.selected.isNotEmpty()) {
                        ContextBar(state.selected, onRemove = viewModel::unselect, onClear = viewModel::clearSelection)
                    }
                    AttachmentBar(
                        attachments = state.attachments,
                        uploading = state.uploading,
                        removingId = state.removingAttachmentId,
                        enabled = session?.status != "archived",
                        onRemove = { a -> scope.launch { viewModel.removeAttachment(a.id)?.let { notice = it } } },
                    )
                    Composer(
                        draft = draft,
                        onDraftChange = { draft = it },
                        enabled = !state.sending,
                        onSend = {
                            viewModel.send(draft.text, withSelection = true)
                            draft = TextFieldValue("")
                        },
                        attach = {
                            AttachButton(
                                // A room exists only after its first message; files need it.
                                enabled = session != null && !state.uploading,
                                maxFiles = RoomViewModel.MAX_FILES,
                                maxBytes = RoomViewModel.MAX_BYTES,
                                onUpload = viewModel::upload,
                                onMessage = { notice = it },
                            )
                        },
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            SquadBar(
                agents = squad.filter { it.id in selection },
                humans = room.participants.size.coerceAtLeast(1),
                totalAgents = squad.count { it.id in selection },
                onOpen = { sheet = "squad" },
            )
            HorizontalDivider()
            session?.let { SupervisorBanner(it) }
            ReauthorizeBanner(state.reauthorizations, resolveUrl)
            if (state.loading && room.turns.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                return@Column
            }
            if (room.turns.isEmpty() && state.pendingMessage == null) {
                EmptyRoom(Modifier.fillMaxSize())
                return@Column
            }
            val actions = TurnCardActions(
                currentUserId = room.currentUserId,
                enabled = !state.sending && session?.status != "archived",
                selected = state.selected,
                onSubmit = { viewModel.send(it) },
                onDecideApproval = viewModel::decideApproval,
                readApproval = viewModel::readApproval,
                onSelect = viewModel::setCardSelection,
                onAct = viewModel::actOn,
                onChangeRecord = viewModel::changeRecord,
                onOpenWorkProduct = { sheet = "workspace" },
                resolveUrl = resolveUrl,
                mapLocation = mapLocation,
                orgId = viewModel.roomOrgId,
                downloadFile = viewModel::downloadAttachment,
                saveSnapshot = viewModel::saveFinancialSnapshot,
                answerInputRequest = viewModel::answerInputRequest,
                skillScope = session?.let { app.oddjob.crew.data.SkillScope(viewModel.sessionKey, viewModel.roomOrgId) },
                skills = viewModel.operationSkills,
                recheckCalendar = viewModel::recheckCalendar,
                verifyCalendar = viewModel::verifyCalendar,
                granolaMeetings = viewModel::granolaMeetings,
                shareGranola = viewModel::shareGranola,
            )
            LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                items(room.turns, key = { it.id }) { turn ->
                    TurnItem(
                        turn = turn,
                        isMine = turn.speakerType == "user" && turn.userId != null && turn.userId == room.currentUserId,
                        resolveUrl = resolveUrl,
                        laterUserTurns = userTurns.filter { it.first > turn.id }.map { it.second },
                        pillNames = memberNames,
                        showDetails = showTurnDetails,
                        actions = actions,
                    )
                }
                state.pendingMessage?.let { pending ->
                    item(key = "pending") { PendingBubble(pending) }
                }
            }
        }
    }

    when (sheet) {
        "members" -> MembersSheet(
            members = state.availableCards.orEmpty().filter { it.id in selection }.ifEmpty { room.members.filter { it.id in selection } },
            available = state.availableCards,
            roomExists = session != null,
            onLoad = viewModel::loadAgentCards,
            onSave = viewModel::saveMembers,
            onDismiss = { sheet = null },
        )
        "squad" -> SquadSheet(
            agents = squad,
            humans = room.participants.map { it.displayName ?: it.username ?: it.userId },
            hiddenStudioAgents = room.members.count(AgentPills::isStudioAgent),
            selected = selection,
            onToggle = { viewModel.toggleAgent(it.id) },
            onAddAgents = { sheet = "members" },
            onMention = { agent ->
                val text = draft.text.trimEnd().let { if (it.isEmpty()) "@${agent.name} " else "$it @${agent.name} " }
                draft = TextFieldValue(text, TextRange(text.length))
            },
            onDismiss = { sheet = null },
        )
        "records" -> RecordsSheet(
            room = room,
            onCreate = viewModel::createRecord,
            onUpdate = viewModel::updateRecord,
            onDismiss = { sheet = null },
        )
        "beacon" -> BeaconFlow(onShare = viewModel::raiseBeacon, onDone = { sheet = null })
        "workspace" -> WorkspaceSheet(
            room = room,
            working = state.roundActive,
            onSaveBrief = viewModel::saveBrief,
            onSaveProduct = viewModel::saveWorkProduct,
            onRequest = { viewModel.send(it) },
            onDismiss = { sheet = null },
        )
        "readiness" -> ReadinessSheet(load = viewModel::readiness, onDismiss = { sheet = null })
        "mode" -> ModeSheet(current = session?.mode ?: "explore", onPick = viewModel::setMode, onDismiss = { sheet = null })
        "conclude" -> androidx.compose.material3.AlertDialog(
            onDismissRequest = { sheet = null },
            title = { Text("Conclude this meeting?") },
            text = { Text("The crew writes a closing brief from the decisions, plans and work products, and the room is archived. You can reopen it later.") },
            confirmButton = { TextButton(onClick = { sheet = null; viewModel.conclude() }) { Text("Conclude") } },
            dismissButton = { TextButton(onClick = { sheet = null }) { Text("Cancel") } },
        )
    }
}

/** The supervisor's standing read on the room, rewritten each round. */
@Composable
private fun SupervisorBanner(session: CrewSession) {
    val topic = session.activeTopic
    val next = session.nextSteps
    if (topic == null && next == null && session.consensusLevel == null) return
    var expanded by rememberSaveable { mutableStateOf(false) }
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainer,
        onClick = { expanded = !expanded },
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    topic ?: "Discussion",
                    style = MaterialTheme.typography.labelLarge,
                    maxLines = if (expanded) 4 else 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                session.consensusLevel?.let {
                    Text("Consensus $it%", style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(start = 8.dp))
                }
            }
            session.consensusLevel?.let {
                LinearProgressIndicator(progress = { it / 100f }, modifier = Modifier.fillMaxWidth())
            }
            if (expanded && next != null) {
                Text("Next: $next", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/** The items the next message will carry, removable one by one. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ContextBar(items: List<WorkspaceSelection>, onRemove: (WorkspaceSelection) -> Unit, onClear: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Chat context · ${items.size} selected", style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                TextButton(onClick = onClear) { Text("Clear all") }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items.forEach { s ->
                    InputChip(
                        selected = false,
                        onClick = { onRemove(s) },
                        label = { Text(s.item.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        leadingIcon = { WorkspaceIcon(s.item.kind, s.item.platform, size = 16.dp) },
                        trailingIcon = { Icon(Icons.Default.Close, "Remove ${s.item.title} from context", Modifier.size(14.dp)) },
                    )
                }
            }
            Text(
                "Your next message will use these items. Replies and changes require approval.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Opening a room from a Gmail directive push: loading, the email it selected, or why it could not. */
@Composable
private fun AlertBanner(alert: AlertHandoff, onRetry: () -> Unit, onDismiss: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                WorkspaceIcon("email")
                Text(
                    when {
                        alert.loading -> "Preparing your email context…"
                        alert.error != null -> "Email context could not be loaded"
                        else -> "Email opened from your directive"
                    },
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onDismiss) { Text("Dismiss") }
            }
            alert.title?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            alert.reason?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            alert.error?.let {
                Text(it, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = onRetry) { Text("Try again") }
            }
            if (!alert.loading && alert.error == null) {
                Text(
                    "The triggering email is in the room above and selected as context. Its card lets you summarize it, draft a reply, or open it in Gmail.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun RoundBar(sending: Boolean, onStop: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.secondaryContainer) {
        Column {
            LinearProgressIndicator(Modifier.fillMaxWidth())
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (sending) "The crew is responding…" else "A round is in progress…",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onStop) {
                    Icon(Icons.Default.Close, null, Modifier.size(16.dp))
                    Text("Stop", Modifier.padding(start = 4.dp))
                }
            }
        }
    }
}

@Composable
private fun ArchivedBar(onReopen: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("This meeting was concluded.", Modifier.weight(1f))
            Button(onClick = onReopen) { Text("Reopen") }
        }
    }
}

@Composable
private fun Composer(
    draft: TextFieldValue,
    onDraftChange: (TextFieldValue) -> Unit,
    enabled: Boolean,
    onSend: () -> Unit,
    attach: @Composable () -> Unit = {},
) {
    Surface(tonalElevation = 3.dp) {
        Row(
            Modifier.fillMaxWidth().padding(8.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            attach()
            OutlinedTextField(
                value = draft,
                onValueChange = onDraftChange,
                placeholder = { Text("Message the crew") },
                maxLines = 6,
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier.weight(1f),
            )
            FilledIconButton(onClick = onSend, enabled = enabled && draft.text.isNotBlank()) {
                Icon(Icons.AutoMirrored.Filled.Send, "Send")
            }
        }
    }
}

@Composable
private fun PendingBubble(text: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), horizontalAlignment = Alignment.End) {
        Surface(color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f), shape = RoundedCornerShape(14.dp)) {
            Text(text, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onPrimaryContainer)
        }
        Text("Sending…", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun EmptyRoom(modifier: Modifier) {
    Box(modifier.padding(32.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Start the discussion", style = MaterialTheme.typography.titleMedium)
            Text(
                "Your first message opens the room and the crew's first round. Choose who takes part from the crew button.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
