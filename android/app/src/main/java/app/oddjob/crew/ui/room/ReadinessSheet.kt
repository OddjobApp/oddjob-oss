package app.oddjob.crew.ui.room

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.oddjob.crew.data.CrewReadiness
import app.oddjob.crew.data.WorkspaceTime
import app.oddjob.crew.ui.cards.Disclosure

/**
 * The room's capabilities: the web's CrewReadinessPanel. Tools offered and a
 * credential preflight; a tool being offered is not proof it will run, and
 * execution still checks permissions and inputs.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReadinessSheet(load: suspend () -> Result<CrewReadiness>, onDismiss: () -> Unit) {
    var attempt by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var report by remember { mutableStateOf<CrewReadiness?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(attempt) {
        loading = true
        load().fold(onSuccess = { report = it; failed = false }, onFailure = { failed = true })
        loading = false
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Capabilities", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Muted("Available tools and credential preflight for this room. Execution still checks permissions and inputs.")
            TextButton(enabled = !loading, onClick = { attempt++ }) { Text(if (loading) "Checking…" else "Refresh checks") }
            if (loading && report == null) CircularProgressIndicator()
            if (failed) Text("Could not check this room. Retry when the connection recovers.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            report?.let { r -> ReadinessBody(r) }
        }
    }
}

@Composable
private fun ReadinessBody(r: CrewReadiness) {
    Muted("Project: ${r.projectId ?: "Organization scope"} · Checked ${r.checkedAt?.let(WorkspaceTime::readable) ?: "now"}")
    r.checks.forEach { check ->
        Column {
            Text(
                "${check.label}: ${check.stateLabel}",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                color = if (check.state == "blocked") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
            )
            if (check.detail.isNotBlank()) Muted(check.detail)
        }
    }
    r.recipes.forEachIndexed { i, recipe ->
        Disclosure(recipe.label, "readiness-recipe-$i") {
            if (recipe.detail.isNotBlank()) Muted(recipe.detail)
            recipe.agentLines.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
    }
    if (r.bindings.isNotEmpty()) Disclosure("Project resources", "readiness-bindings") {
        r.bindings.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
    if (r.integrations.isNotEmpty()) Disclosure("Configured integrations", "readiness-integrations") {
        r.integrations.forEach { (line, sync) ->
            Column {
                Text(line, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                Muted(sync)
            }
        }
    }
    if (r.appliedSkills.isNotEmpty()) Disclosure("Applied skill augmentations", "readiness-skills") {
        r.appliedSkills.forEach { (line, tools) ->
            Column {
                Text(line, style = MaterialTheme.typography.bodySmall)
                Muted(tools)
            }
        }
    }
    r.agents.forEach { agent ->
        Disclosure("${agent.name} · ${agent.tools.size} available tools", "readiness-agent-${agent.id}") {
            if (agent.unavailable.isNotEmpty()) Text("Declared but unavailable: ${agent.unavailable.joinToString(", ")}", style = MaterialTheme.typography.bodySmall)
            Text(agent.tools.joinToString("\n"), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun Muted(text: String) =
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
