package app.oddjob.crew.ui.approvals

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.oddjob.crew.data.ApiException
import app.oddjob.crew.data.ApprovalView
import app.oddjob.crew.data.DecisionOutcome
import app.oddjob.crew.data.OddjobApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ApprovalsUiState(
    val approvals: List<ApprovalView> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val signedOut: Boolean = false,
    /** The approval a tapped push named; shown first. */
    val focusId: Int? = null,
)

/** The pushed approval first, then the rest newest first, as the server sends them. */
fun focusedFirst(approvals: List<ApprovalView>, focusId: Int?): List<ApprovalView> {
    if (focusId == null) return approvals
    val (focused, rest) = approvals.partition { it.id == focusId }
    return focused + rest
}

/**
 * Approvals waiting on this person: where an approval push lands. The web's
 * equivalent is the workbench decision inbox, which the phone cannot open
 * without a browser session.
 */
class ApprovalsViewModel(private val api: OddjobApi, focusId: Int?) : ViewModel() {
    private val _state = MutableStateFlow(ApprovalsUiState(focusId = focusId))
    val state: StateFlow<ApprovalsUiState> = _state

    init { refresh() }

    fun refresh() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { api.approvals() }
                .onSuccess { list -> _state.update { it.copy(approvals = focusedFirst(list, it.focusId), loading = false) } }
                .onFailure { e ->
                    val unauthorized = (e as? ApiException)?.isUnauthorized == true && !api.sessionIsValid()
                    _state.update { it.copy(loading = false, signedOut = unauthorized, error = if (unauthorized) null else e.message ?: "Something went wrong.") }
                }
        }
    }

    suspend fun decide(view: ApprovalView, approved: Boolean, code: String?, edits: Map<String, String>): DecisionOutcome {
        val id = view.id ?: return DecisionOutcome.Failed("This request has no id to decide.")
        return api.decideApproval(id, approved, code, edits)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalsScreen(state: ApprovalsUiState, viewModel: ApprovalsViewModel, onBack: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                title = { Text("Approvals") },
                actions = { IconButton(onClick = viewModel::refresh) { Icon(Icons.Default.Refresh, "Refresh") } },
            )
        },
    ) { padding ->
        when {
            state.loading && state.approvals.isEmpty() -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            state.approvals.isEmpty() -> Box(Modifier.fillMaxSize().padding(padding).padding(24.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        state.error ?: if (state.focusId != null) "That approval was already decided. Nothing else is waiting on you." else "Nothing is waiting on you.",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    OutlinedButton(onClick = viewModel::refresh) { Text("Refresh") }
                }
            }
            else -> LazyColumn(
                Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                state.error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
                items(state.approvals, key = { it.id ?: it.hashCode() }) { view ->
                    ApprovalCard(view = view, stateKey = "inbox-${view.id}", onDecide = { approved, code, edits -> viewModel.decide(view, approved, code, edits) })
                }
            }
        }
    }
}
