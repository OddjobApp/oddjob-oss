package app.oddjob.crew.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.oddjob.crew.BuildConfig
import app.oddjob.crew.data.ApiException
import app.oddjob.crew.data.OddjobApi
import app.oddjob.crew.data.SessionStore
import app.oddjob.crew.data.UserProfile
import app.oddjob.crew.push.PushStatus
import app.oddjob.crew.ui.cards.CardSurface
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.ZoneId

data class SettingsUiState(
    val profile: UserProfile? = null,
    val loading: Boolean = true,
    val saving: Boolean = false,
    val message: String? = null,
    val signedOut: Boolean = false,
    val showTurnDetails: Boolean = true,
    val useLocationOnMaps: Boolean = true,
)

/** The editable copy of the server profile. */
data class ProfileDraft(
    val firstName: String = "",
    val lastName: String = "",
    val slackHandle: String = "",
    val quietHoursEnabled: Boolean = false,
    val quietHoursStart: String = "22:00",
    val quietHoursEnd: String = "07:00",
    val quietHoursTimezone: String = ZoneId.systemDefault().id,
) {
    companion object {
        fun of(p: UserProfile) = ProfileDraft(
            firstName = p.firstName.orEmpty(),
            lastName = p.lastName.orEmpty(),
            slackHandle = p.slackHandle.orEmpty(),
            quietHoursEnabled = p.quietHoursEnabled == true,
            quietHoursStart = p.quietHoursStart ?: "22:00",
            quietHoursEnd = p.quietHoursEnd ?: "07:00",
            quietHoursTimezone = p.quietHoursTimezone ?: ZoneId.systemDefault().id,
        )
    }

    /** The PATCH body: only what differs from [base], so an untouched field is never rewritten. */
    fun changesFrom(base: UserProfile): JsonObject {
        val out = LinkedHashMap<String, kotlinx.serialization.json.JsonElement>()
        fun text(key: String, now: String, was: String?) {
            if (now.trim() != was.orEmpty()) out[key] = if (now.isBlank()) JsonNull else JsonPrimitive(now.trim())
        }
        text("firstName", firstName, base.firstName)
        text("lastName", lastName, base.lastName)
        text("slackHandle", slackHandle, base.slackHandle)
        if (quietHoursEnabled != (base.quietHoursEnabled == true)) out["quietHoursEnabled"] = JsonPrimitive(quietHoursEnabled)
        // Times and zone travel together whenever quiet hours are on, so the
        // server never holds an enabled window with no bounds.
        if (quietHoursEnabled || base.quietHoursStart != null) {
            if (quietHoursStart != base.quietHoursStart) out["quietHoursStart"] = JsonPrimitive(quietHoursStart)
            if (quietHoursEnd != base.quietHoursEnd) out["quietHoursEnd"] = JsonPrimitive(quietHoursEnd)
            if (quietHoursTimezone != base.quietHoursTimezone) out["quietHoursTimezone"] = JsonPrimitive(quietHoursTimezone)
        }
        return JsonObject(out)
    }
}

class SettingsViewModel(
    private val api: OddjobApi,
    private val session: SessionStore,
    private val onSignOut: suspend () -> Unit,
) : ViewModel() {
    private val _state = MutableStateFlow(SettingsUiState(showTurnDetails = session.showTurnDetails, useLocationOnMaps = session.useLocationOnMaps))
    val state: StateFlow<SettingsUiState> = _state

    val serverUrl: String get() = session.serverUrl.orEmpty()

    init {
        viewModelScope.launch {
            runCatching { api.profile() }
                .onSuccess { p -> _state.update { it.copy(profile = p, loading = false) } }
                .onFailure { e -> fail(e) }
        }
    }

    fun save(draft: ProfileDraft) {
        val base = _state.value.profile ?: return
        val changes = draft.changesFrom(base)
        if (changes.isEmpty()) {
            _state.update { it.copy(message = "Nothing to save.") }
            return
        }
        _state.update { it.copy(saving = true) }
        viewModelScope.launch {
            runCatching { api.updateProfile(changes) }
                .onSuccess { p -> _state.update { it.copy(profile = p, saving = false, message = "Saved.") } }
                .onFailure { e -> _state.update { it.copy(saving = false) }; fail(e) }
        }
    }

    fun setShowTurnDetails(value: Boolean) {
        session.showTurnDetails = value
        _state.update { it.copy(showTurnDetails = value) }
    }

    fun setUseLocationOnMaps(value: Boolean) {
        session.useLocationOnMaps = value
        _state.update { it.copy(useLocationOnMaps = value) }
    }

    fun signOut() {
        viewModelScope.launch {
            onSignOut()
            _state.update { it.copy(signedOut = true) }
        }
    }

    fun messageShown() = _state.update { it.copy(message = null) }

    private suspend fun fail(e: Throwable) {
        val unauthorized = (e as? ApiException)?.isUnauthorized == true && !api.sessionIsValid()
        _state.update {
            it.copy(loading = false, signedOut = unauthorized, message = if (unauthorized) null else e.message ?: "Something went wrong.")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(viewModel: SettingsViewModel, state: SettingsUiState, pushStatus: PushStatus?, onBack: () -> Unit) {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(state.message) {
        state.message?.let { snackbar.showSnackbar(it); viewModel.messageShown() }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                title = { Text("Settings") },
            )
        },
    ) { padding ->
        val profile = state.profile
        if (state.loading || profile == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                if (state.loading) CircularProgressIndicator()
            }
            return@Scaffold
        }
        var draft by rememberSaveable(profile, stateSaver = DraftSaver) { mutableStateOf(ProfileDraft.of(profile)) }
        var confirmSignOut by remember { mutableStateOf(false) }

        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Section("Profile") {
                ReadOnlyRow("Username", profile.username)
                ReadOnlyRow("Email", profile.email ?: "—")
                OutlinedTextField(draft.firstName, { draft = draft.copy(firstName = it) }, label = { Text("First name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(draft.lastName, { draft = draft.copy(lastName = it) }, label = { Text("Last name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(draft.slackHandle, { draft = draft.copy(slackHandle = it) }, label = { Text("Slack handle") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }

            Section("Quiet hours") {
                SwitchRow(
                    title = "Quiet hours",
                    detail = "Hold non-urgent alerts during these hours. Applied by the server, on every device.",
                    checked = draft.quietHoursEnabled,
                    onChange = { draft = draft.copy(quietHoursEnabled = it) },
                )
                if (draft.quietHoursEnabled) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        TimeField("From", draft.quietHoursStart, Modifier.weight(1f)) { draft = draft.copy(quietHoursStart = it) }
                        TimeField("Until", draft.quietHoursEnd, Modifier.weight(1f)) { draft = draft.copy(quietHoursEnd = it) }
                    }
                    OutlinedTextField(
                        draft.quietHoursTimezone,
                        { draft = draft.copy(quietHoursTimezone = it) },
                        label = { Text("Timezone") },
                        supportingText = { Text("IANA name, e.g. Europe/Amsterdam") },
                        singleLine = true,
                        trailingIcon = {
                            TextButton(onClick = { draft = draft.copy(quietHoursTimezone = ZoneId.systemDefault().id) }) { Text("This device") }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            Button(
                onClick = { viewModel.save(draft) },
                enabled = !state.saving,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (state.saving) "Saving…" else "Save profile") }

            Section("Notifications") {
                NotificationsStatus(pushStatus)
            }

            Section("Location") {
                MapLocationSetting(state.useLocationOnMaps, viewModel::setUseLocationOnMaps)
            }

            Section("App") {
                SwitchRow(
                    title = "Tool and model details",
                    detail = "Show which tools an agent ran and which model answered, under each turn.",
                    checked = state.showTurnDetails,
                    onChange = viewModel::setShowTurnDetails,
                )
                ReadOnlyRow("Server", viewModel.serverUrl)
                ReadOnlyRow("Version", BuildConfig.VERSION_NAME)
            }

            OutlinedButton(onClick = { confirmSignOut = true }, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
        }

        if (confirmSignOut) {
            AlertDialog(
                onDismissRequest = { confirmSignOut = false },
                title = { Text("Sign out?") },
                text = { Text("You'll need your password to sign in again.") },
                confirmButton = { TextButton(onClick = { confirmSignOut = false; viewModel.signOut() }) { Text("Sign out") } },
                dismissButton = { TextButton(onClick = { confirmSignOut = false }) { Text("Cancel") } },
            )
        }
    }
}

private val DraftSaver = androidx.compose.runtime.saveable.listSaver<ProfileDraft, Any>(
    save = { listOf(it.firstName, it.lastName, it.slackHandle, it.quietHoursEnabled, it.quietHoursStart, it.quietHoursEnd, it.quietHoursTimezone) },
    restore = {
        ProfileDraft(it[0] as String, it[1] as String, it[2] as String, it[3] as Boolean, it[4] as String, it[5] as String, it[6] as String)
    },
)

/**
 * "Use my location on maps": turning it on asks Android for the location
 * permission; when Android has it denied for good, the row links to the app's
 * system settings, the only place it can be granted then.
 */
@Composable
private fun MapLocationSetting(enabled: Boolean, onChange: (Boolean) -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    fun granted() = androidx.core.content.ContextCompat.checkSelfPermission(
        context, android.Manifest.permission.ACCESS_COARSE_LOCATION,
    ) == android.content.pm.PackageManager.PERMISSION_GRANTED
    var permitted by remember { mutableStateOf(granted()) }
    // Back from system settings, the answer may have changed.
    androidx.lifecycle.compose.LifecycleResumeEffect(Unit) {
        permitted = granted()
        onPauseOrDispose { }
    }
    val launcher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        permitted = result.values.any { it }
        onChange(true)
    }
    SwitchRow(
        title = "Use my location on maps",
        detail = "Show where you are on map cards, and centre maps that have nothing else to show on you. Your position stays on this phone.",
        checked = enabled,
        onChange = { on ->
            if (on && !granted()) {
                launcher.launch(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION))
            } else {
                onChange(on)
            }
        },
    )
    if (enabled) {
        Text(
            if (permitted) "Location permission: allowed" else "Location permission: not allowed. Maps will not show your position.",
            style = MaterialTheme.typography.bodySmall,
            color = if (permitted) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
        )
        if (!permitted) {
            TextButton(onClick = {
                val intent = android.content.Intent(
                    android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    android.net.Uri.fromParts("package", context.packageName, null),
                )
                runCatching { context.startActivity(intent) }
            }) { Text("Open Android settings") }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        CardSurface { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { content() } }
    }
}

@Composable
private fun ReadOnlyRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun SwitchRow(title: String, detail: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onChange(!checked) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimeField(label: String, value: String, modifier: Modifier, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        OutlinedTextField(value, {}, readOnly = true, label = { Text(label) }, modifier = Modifier.fillMaxWidth())
        Box(Modifier.matchParentSize().clickable { open = true })
    }
    if (open) {
        val parts = value.split(':')
        val state = rememberTimePickerState(parts.getOrNull(0)?.toIntOrNull() ?: 22, parts.getOrNull(1)?.toIntOrNull() ?: 0, is24Hour = true)
        AlertDialog(
            onDismissRequest = { open = false },
            confirmButton = { TextButton(onClick = { onChange("%02d:%02d".format(state.hour, state.minute)); open = false }) { Text("OK") } },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
            text = { TimePicker(state) },
        )
    }
}

/** Where push stands, in words, with the one action that can fix it from here. */
@Composable
private fun NotificationsStatus(status: PushStatus?) {
    val context = LocalContext.current
    val (title, detail) = when (status) {
        PushStatus.REGISTERED -> "On" to "Approvals waiting for you and missions you started finishing arrive here, also while the app is closed."
        PushStatus.PERMISSION_OFF -> "Blocked on this phone" to "Allow notifications for Oddjob to receive them."
        PushStatus.SERVER_OFF -> "Not set up on the server" to "Your Oddjob server has no Firebase service account, so it cannot reach phones yet."
        PushStatus.NOT_IN_BUILD -> "Not in this build" to "This build of the app was made without Firebase, so it cannot receive push."
        PushStatus.FAILED -> "Could not register" to "The server could not be reached to register this phone. It retries next time you open the app."
        null -> "Checking…" to ""
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.bodyLarge)
        if (detail.isNotEmpty()) {
            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (status == PushStatus.PERMISSION_OFF) {
            OutlinedButton(onClick = {
                context.startActivity(
                    android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName),
                )
            }) { Text("Open notification settings") }
        }
    }
}
