package app.oddjob.crew.ui.rooms

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.oddjob.crew.data.ApiException
import app.oddjob.crew.data.OddjobApi
import app.oddjob.crew.data.RoomSummary
import app.oddjob.crew.data.newRoomKey
import app.oddjob.crew.ui.theme.BrandTitle
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RoomsUiState(
    val rooms: List<RoomSummary> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val signedOut: Boolean = false,
)

class RoomsViewModel(private val api: OddjobApi, private val cache: app.oddjob.crew.data.RoomCache) : ViewModel() {
    private val _state = MutableStateFlow(RoomsUiState())
    val state: StateFlow<RoomsUiState> = _state

    init {
        // The saved list shows at once; the fetch below replaces it.
        viewModelScope.launch {
            val cached = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { cache.loadRooms() }
            if (cached != null) _state.update { if (it.rooms.isEmpty()) it.copy(rooms = cached) else it }
        }
        refresh()
    }

    fun refresh() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { api.rooms() }
                .onSuccess { rooms ->
                    _state.update { it.copy(rooms = rooms, loading = false) }
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { runCatching { cache.saveRooms(rooms) } }
                }
                .onFailure { e ->
                    val signedOut = (e as? ApiException)?.isUnauthorized == true && !api.sessionIsValid()
                    _state.update {
                        it.copy(loading = false, error = e.message ?: "Could not load rooms.", signedOut = signedOut)
                    }
                }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { cache.clear() }
            api.logout()
            _state.update { it.copy(signedOut = true) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomsScreen(
    viewModel: RoomsViewModel,
    state: RoomsUiState,
    /** A room key and, from the list, its organization (null for a new or joined room). */
    onOpenRoom: (String, Int?) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenApprovals: () -> Unit,
) {
    var joining by rememberSaveable { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { BrandTitle(subtitle = "CREW rooms") },
                actions = {
                    IconButton(onClick = viewModel::refresh) { Icon(Icons.Default.Refresh, "Refresh") }
                    IconButton(onClick = onOpenApprovals) { Icon(Icons.Default.CheckCircle, "Approvals") }
                    IconButton(onClick = onOpenSettings) { Icon(Icons.Default.Settings, "Settings") }
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { onOpenRoom(newRoomKey(), null) },
                icon = { Icon(Icons.Default.Add, null) },
                text = { Text("New room") },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.loading,
            onRefresh = viewModel::refresh,
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(Modifier.fillMaxSize()) {
                state.error?.let { error ->
                    item { Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) }
                }
                if (!state.loading && state.rooms.isEmpty() && state.error == null) {
                    item {
                        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("No rooms yet", style = MaterialTheme.typography.titleMedium)
                            Text(
                                "Rooms you take part in appear here. Start one, or join a room by its key.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                // Rooms from several organizations say which one each belongs to.
                val showOrg = state.rooms.mapNotNull { it.organizationId }.distinct().size > 1
                items(state.rooms, key = { it.sessionKey }) { room ->
                    RoomRow(room, showOrg) { onOpenRoom(room.sessionKey, room.organizationId) }
                }
                item {
                    Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                        TextButton(onClick = { joining = true }) { Text("Join a room by key") }
                    }
                }
            }
        }
    }

    if (joining) {
        var key by rememberSaveable { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { joining = false },
            title = { Text("Join a room") },
            text = {
                OutlinedTextField(
                    value = key,
                    onValueChange = { key = it },
                    label = { Text("Room key or link") },
                    singleLine = true,
                )
            },
            confirmButton = {
                TextButton(
                    enabled = key.isNotBlank(),
                    onClick = {
                        joining = false
                        onOpenRoom(roomKeyFromInput(key), roomOrgIdFromPath(key))
                    },
                ) { Text("Open") }
            },
            dismissButton = { TextButton(onClick = { joining = false }) { Text("Cancel") } },
        )
    }
}

/** Accepts a bare key or a shared `/workspace/chat/<key>?orgId=` link. */
fun roomKeyFromInput(input: String): String {
    val trimmed = input.trim()
    val marker = "/workspace/chat/"
    val at = trimmed.indexOf(marker)
    if (at < 0) return trimmed
    return trimmed.substring(at + marker.length).substringBefore('?').substringBefore('#').trimEnd('/')
}

/** The `orgId` a shared room link or notification path names, if any. */
fun roomOrgIdFromPath(input: String): Int? =
    input.substringAfter('?', "").substringBefore('#').split('&')
        .firstOrNull { it.substringBefore('=') == "orgId" }
        ?.substringAfter('=')?.toIntOrNull()?.takeIf { it > 0 }

@Composable
private fun RoomRow(room: RoomSummary, showOrg: Boolean, onClick: () -> Unit) {
    androidx.compose.material3.Surface(
        onClick = onClick,
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 5.dp),
    ) {
    Column(
        Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                room.title ?: room.activeTopic ?: room.sessionKey,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (room.status == "archived") AssistChip(onClick = {}, label = { Text("Concluded") })
            if (room.isBreakout) AssistChip(onClick = {}, label = { Text("Breakout") })
        }
        room.activeTopic?.takeIf { it != room.title }?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Text(
            buildString {
                if (showOrg) (room.organizationName ?: room.organizationId?.let { "Org $it" })?.let { append("$it · ") }
                append("${room.participantCount} ${if (room.participantCount == 1) "person" else "people"}")
                if (room.attachmentCount > 0) append(" · ${room.attachmentCount} attachments")
                room.updatedAt?.let { append(" · ${it.take(10)}") }
            },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
}
