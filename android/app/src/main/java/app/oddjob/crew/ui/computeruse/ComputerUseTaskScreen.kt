package app.oddjob.crew.ui.computeruse

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.oddjob.crew.data.ApiException
import app.oddjob.crew.data.ComputerUseTask
import app.oddjob.crew.data.OddjobApi
import app.oddjob.crew.ui.cards.CardSurface
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Answering a computer-use task that stopped for its owner, from the push.
 *
 * The web answers this in the live viewer, which the phone does not have: a
 * tapped pause notification used to open that page in the browser, where the
 * app's session does not exist. This screen covers what can be answered
 * without the desktop: approving or refusing a risky action, and sending the
 * reply a handoff asks for (a one-time code, "done, I logged in").
 */
data class ComputerUseUiState(
    val task: ComputerUseTask? = null,
    val loading: Boolean = true,
    /** Which answer is in flight: true continue, false stop. */
    val submitting: Boolean? = null,
    /** What the last answer did, in words, once the server replied. */
    val outcome: String? = null,
    val error: String? = null,
    val signedOut: Boolean = false,
)

/** The words for a paused task, kept out of the composable so they are tested. */
data class PauseCopy(val title: String, val prompt: String, val replyLabel: String, val continueLabel: String)

fun pauseCopy(task: ComputerUseTask): PauseCopy {
    val pending = task.pending
    val explanation = pending?.explanation?.trim().orEmpty()
    return if (pending?.kind == "safety") {
        PauseCopy(
            title = "A computer action needs your approval",
            prompt = explanation.ifEmpty { "The agent wants to take an action that needs your say-so." },
            replyLabel = "Note for the agent (optional)",
            continueLabel = "Approve and continue",
        )
    } else {
        PauseCopy(
            title = "The computer needs you",
            prompt = explanation.ifEmpty { "The agent stopped and is waiting for you." },
            replyLabel = "Reply, e.g. a code (optional)",
            continueLabel = "Continue task",
        )
    }
}

/** A task that is no longer waiting, described for the person who came to answer it. */
fun settledLine(status: String): String = when (status) {
    "running", "queued" -> "The task is running."
    "succeeded" -> "The task finished."
    "failed" -> "The task failed."
    "cancelled" -> "The task was stopped."
    "blocked" -> "The task was blocked by a safety check."
    "needs_confirmation" -> "The task is waiting for you again."
    else -> "The task is $status."
}

class ComputerUseTaskViewModel(
    private val api: OddjobApi,
    private val taskId: String,
    private val orgId: Int?,
) : ViewModel() {
    private val _state = MutableStateFlow(ComputerUseUiState())
    val state: StateFlow<ComputerUseUiState> = _state

    init { refresh() }

    /** [keepError] holds a message that explains why the screen reloaded. */
    fun refresh(keepError: Boolean = false) {
        _state.update { it.copy(loading = true, error = if (keepError) it.error else null) }
        viewModelScope.launch {
            runCatching { api.computerUseTask(taskId, orgId) }
                .onSuccess { t -> _state.update { it.copy(task = t, loading = false) } }
                .onFailure { e -> fail(e) }
        }
    }

    fun answer(allow: Boolean, reply: String) {
        if (_state.value.submitting != null) return
        _state.update { it.copy(submitting = allow, error = null, outcome = null) }
        viewModelScope.launch {
            runCatching { api.confirmComputerUseTask(taskId, allow, reply.takeIf { allow }, orgId) }
                .onSuccess { t ->
                    _state.update { it.copy(task = t, submitting = null, outcome = settledLine(t.status)) }
                }
                .onFailure { e -> _state.update { it.copy(submitting = null) }; fail(e) }
        }
    }

    private suspend fun fail(e: Throwable) {
        val unauthorized = (e as? ApiException)?.isUnauthorized == true && !api.sessionIsValid()
        val message = when {
            unauthorized -> null
            (e as? ApiException)?.status == 404 -> "This task was not found. It may belong to another organization."
            // Someone answered it first, on another device or the web.
            (e as? ApiException)?.status == 400 -> e.message ?: "This task is no longer waiting."
            else -> e.message ?: "Something went wrong."
        }
        _state.update { it.copy(loading = false, signedOut = unauthorized, error = message) }
        if ((e as? ApiException)?.status == 400) refresh(keepError = true)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComputerUseTaskScreen(state: ComputerUseUiState, viewModel: ComputerUseTaskViewModel, onBack: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                title = { Text("Computer task") },
            )
        },
    ) { padding ->
        val task = state.task
        if (task == null) {
            Box(Modifier.fillMaxSize().padding(padding).padding(24.dp), contentAlignment = Alignment.Center) {
                if (state.loading) CircularProgressIndicator()
                else Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(state.error ?: "This task could not be loaded.", style = MaterialTheme.typography.bodyLarge)
                    OutlinedButton(onClick = { viewModel.refresh() }) { Text("Try again") }
                }
            }
            return@Scaffold
        }

        var reply by rememberSaveable(task.id) { mutableStateOf("") }
        var confirmStop by remember { mutableStateOf(false) }
        val busy = state.submitting != null

        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            CardSurface {
                Text("TASK", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(task.task, style = MaterialTheme.typography.bodyMedium)
            }

            state.outcome?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
            state.error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }

            if (task.waitingForPerson) {
                val copy = pauseCopy(task)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(copy.title, style = MaterialTheme.typography.titleMedium)
                    Text(copy.prompt, style = MaterialTheme.typography.bodyMedium)
                    task.pending?.action?.let {
                        Text("Action: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (task.pending?.kind == "yield") {
                    Text(
                        "If it needs you on the desktop itself (a login or a CAPTCHA), do that from a computer, then continue here.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OutlinedTextField(
                    reply,
                    { reply = it },
                    label = { Text(copy.replyLabel) },
                    enabled = !busy,
                    // A code is typed as-is; no autocorrect or capitalisation.
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(onClick = { viewModel.answer(true, reply) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    Text(if (state.submitting == true) "Continuing… the agent is working" else copy.continueLabel)
                }
                OutlinedButton(onClick = { confirmStop = true }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    Text(if (state.submitting == false) "Stopping…" else "Stop task")
                }
            } else if (state.outcome == null) {
                Text(settledLine(task.status), style = MaterialTheme.typography.bodyLarge)
                OutlinedButton(onClick = { viewModel.refresh() }, modifier = Modifier.fillMaxWidth()) { Text("Refresh") }
            }
        }

        if (confirmStop) {
            AlertDialog(
                onDismissRequest = { confirmStop = false },
                title = { Text("Stop this task?") },
                text = { Text("The agent stops here and the task is cancelled.") },
                confirmButton = { TextButton(onClick = { confirmStop = false; viewModel.answer(false, "") }) { Text("Stop task") } },
                dismissButton = { TextButton(onClick = { confirmStop = false }) { Text("Cancel") } },
            )
        }
    }
}
