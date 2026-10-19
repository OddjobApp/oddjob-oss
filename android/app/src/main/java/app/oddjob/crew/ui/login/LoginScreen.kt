package app.oddjob.crew.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.oddjob.crew.BuildConfig
import app.oddjob.crew.data.OddjobApi
import app.oddjob.crew.data.SessionStore
import app.oddjob.crew.ui.theme.BrandLockup
import app.oddjob.crew.ui.theme.LoginBackdrop
import androidx.compose.foundation.background
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LoginUiState(
    val checkingSession: Boolean = true,
    val busy: Boolean = false,
    val error: String? = null,
    val signedIn: Boolean = false,
)

class LoginViewModel(private val api: OddjobApi, private val session: SessionStore) : ViewModel() {
    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state

    val initialServer: String get() = session.serverUrl ?: BuildConfig.DEFAULT_SERVER_URL
    val initialUser: String get() = session.username.orEmpty()

    init {
        // A stored 30-day cookie skips the form; the server is the judge of
        // whether it is still good.
        viewModelScope.launch {
            val check = if (session.serverUrl == null) null else runCatching { api.currentUser().authenticated }
            // Unreachable is not signed out: with someone signed in here, the app
            // opens on its saved rooms, and the first answer from the server
            // decides (every screen signs out on a confirmed 401).
            val offline = check?.exceptionOrNull()?.let { it !is app.oddjob.crew.data.ApiException } == true
            val resumed = check?.getOrNull() == true || (offline && session.username != null)
            // Someone was signed in here and the server no longer accepts it: the
            // server expires idle sessions on purpose, so say so plainly.
            val expired = !resumed && session.username != null
            _state.update {
                it.copy(
                    checkingSession = false,
                    signedIn = resumed,
                    error = if (expired) "Your session timed out. Sign in again to continue." else null,
                )
            }
        }
    }

    fun signIn(server: String, identifier: String, password: String) {
        if (server.isBlank() || identifier.isBlank() || password.isEmpty()) {
            _state.update { it.copy(error = "Server, username and password are all required.") }
            return
        }
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            runCatching { api.login(server, identifier.trim(), password) }
                .onSuccess { _state.update { it.copy(busy = false, signedIn = true) } }
                .onFailure { e ->
                    _state.update { it.copy(busy = false, error = e.message ?: "Sign-in failed.") }
                }
        }
    }
}

@Composable
fun LoginScreen(viewModel: LoginViewModel, state: LoginUiState) {
    var server by rememberSaveable { mutableStateOf(viewModel.initialServer) }
    var user by rememberSaveable { mutableStateOf(viewModel.initialUser) }
    var password by rememberSaveable { mutableStateOf("") }

    Scaffold { padding ->
        if (state.checkingSession) {
            Column(
                Modifier.fillMaxSize().background(LoginBackdrop).padding(padding),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                app.oddjob.crew.ui.theme.LaunchLockup()
                CircularProgressIndicator(Modifier.padding(top = 40.dp).size(28.dp), strokeWidth = 3.dp)
            }
            return@Scaffold
        }
        Column(
            Modifier
                .fillMaxSize()
                .background(LoginBackdrop)
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            BrandLockup(Modifier.padding(top = 24.dp, bottom = 12.dp))
            Text(
                "Sign in to CREW with your Oddjob account.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = server,
                onValueChange = { server = it },
                label = { Text("Server") },
                supportingText = { Text("The emulator reaches your computer at 10.0.2.2") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = user,
                onValueChange = { user = it },
                label = { Text("Username or email") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth(),
            )
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = { viewModel.signIn(server, user, password) },
                enabled = !state.busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (state.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Text("Sign in")
            }
        }
    }
}
