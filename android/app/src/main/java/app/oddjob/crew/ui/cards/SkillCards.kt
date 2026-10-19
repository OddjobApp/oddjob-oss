package app.oddjob.crew.ui.cards

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.oddjob.crew.data.GuidanceReceipt
import app.oddjob.crew.data.ImportedSkillReceipt
import app.oddjob.crew.data.OperationSkillDraft
import app.oddjob.crew.data.OperationSkills
import app.oddjob.crew.data.SkillScope
import app.oddjob.crew.data.SkillValidation
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** A heading that opens and closes what is under it, like the web's <details>. */
@Composable
internal fun Disclosure(title: String, stateKey: String, initiallyOpen: Boolean = false, content: @Composable () -> Unit) {
    var open by rememberSaveable(stateKey) { mutableStateOf(initiallyOpen) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            "${if (open) "▾" else "▸"} $title",
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.fillMaxWidth().clickable { open = !open }.padding(vertical = 4.dp),
        )
        if (open) content()
    }
}

@Composable
private fun Muted(text: String) =
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

/** Procedures loaded into an agent's prompt. Loading is not execution: tools_used is the evidence. */
@Composable
fun GuidanceReceiptCard(receipt: GuidanceReceipt, stateKey: String) {
    CardSurface {
        Disclosure("Guidance loaded · ${receipt.entries.size} procedures", stateKey) {
            Muted("Loaded into this agent’s prompt. This does not establish tool execution or successful completion.")
            receipt.entries.forEach { entry ->
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(entry.label, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                    if (entry.reason.isNotBlank()) Muted(entry.reason)
                    Muted("Version ${entry.version} · ${entry.contentHash}")
                }
            }
        }
    }
}

/** Reviewed skill contracts selected for the turn, with the tool evidence each has. */
@Composable
fun ImportedSkillReceiptCard(receipt: ImportedSkillReceipt, stateKey: String) {
    if (!receipt.visible) return
    CardSurface {
        Disclosure("Imported skills · ${if (receipt.unavailable) "Selection unavailable" else receipt.entries.size}", stateKey) {
            Muted("Reviewed contracts selected for this turn. Tool evidence does not establish completion of the whole workflow; imported code was not executed.")
            if (receipt.unavailable) Text("Selection could not be checked. This does not mean no skills are available.", style = MaterialTheme.typography.bodySmall)
            receipt.entries.forEach { entry ->
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("${entry.name} · ${entry.statusLabel}", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                    if (entry.missingTools.isNotEmpty()) Text("Missing: ${entry.missingTools.joinToString(", ")}", style = MaterialTheme.typography.bodySmall)
                    entry.calls.forEach { (name, ok) -> Muted("$name: ${if (ok) "Succeeded" else "Failed"}") }
                    Muted("Review #${entry.reviewId} · Contract ${entry.contractHash}")
                }
            }
        }
    }
}

/**
 * A verified operation exported as a skill draft. Exporting registers and
 * activates nothing; review, submission and approval are separate steps, and
 * the last two need organization management permission.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OperationSkillDraftCard(draft: OperationSkillDraft, skills: OperationSkills?, scope: SkillScope?) {
    val context = LocalContext.current
    fun share(title: String, text: String) {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_SUBJECT, title)
            .putExtra(Intent.EXTRA_TEXT, text)
        context.startActivity(Intent.createChooser(send, title))
    }
    val markdown = remember(draft) { draft.markdown() }
    CardSurface {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${draft.name} · Draft", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Muted("Review and test with different inputs before enabling reuse. This export does not register or activate a skill.")
            Disclosure("Review workflow", "skill-md-${draft.evidenceHash}") {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        markdown,
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState()).padding(10.dp),
                    )
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { share("SKILL.md", markdown) }) { Text("Share SKILL.md") }
                TextButton(onClick = { share("skill-draft.json", draft.raw.toString()) }) { Text("Share contract") }
            }
            if (skills != null && scope != null) OperationSkillReview(draft, skills, scope)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun OperationSkillReview(draft: OperationSkillDraft, skills: OperationSkills, scope: SkillScope) {
    val key = "${scope.orgId}:${scope.roomKey}:${draft.evidenceHash}"
    var open by rememberSaveable(key) { mutableStateOf(false) }
    var busy by remember(key) { mutableStateOf(false) }
    var error by remember(key) { mutableStateOf<String?>(null) }
    var name by rememberSaveable(key) { mutableStateOf(draft.name) }
    var inputs by remember(key) { mutableStateOf(draft.inputs) }
    var agents by remember(key) { mutableStateOf<List<Pair<Int, String>>>(emptyList()) }
    var target by rememberSaveable(key) { mutableStateOf(draft.targetAgentId ?: 0) }
    var status by remember(key) { mutableStateOf<String?>(null) }
    var validation by remember(key) { mutableStateOf<SkillValidation?>(null) }
    var picking by remember { mutableStateOf(false) }
    val scopeLaunch = rememberCoroutineScope()

    suspend fun load(): Boolean = skills.review(scope, draft.evidenceHash).fold(
        onSuccess = { state ->
            agents = state.agents
            status = state.status
            name = state.draft.name
            inputs = state.draft.inputs
            target = state.draft.targetAgentId ?: state.agents.firstOrNull()?.first ?: 0
            true
        },
        onFailure = { false },
    )

    fun act(action: String) {
        busy = true
        error = null
        scopeLaunch.launch {
            val body: JsonObject = if (action == "approve") JsonObject(emptyMap()) else buildJsonObject {
                put("name", name)
                put("inputs", buildJsonObject { inputs.forEach { (k, v) -> put(k, v) } })
                put("targetAgentId", target)
            }
            skills.act(scope, draft.evidenceHash, action, body).fold(
                onSuccess = { result -> if (action == "validate") validation = SkillValidation.parse(result) else load() },
                onFailure = { error = "Review action failed. Check access and validation blockers. Registration and approval require organization management permission." },
            )
            busy = false
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(enabled = !busy, onClick = {
            if (open) { open = false; return@OutlinedButton }
            busy = true
            error = null
            scopeLaunch.launch {
                if (load()) open = true else error = "Could not load this scoped skill draft."
                busy = false
            }
        }) { Text("Review and register skill") }
        error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        if (!open) return@Column

        val locked = status != null || busy
        Muted("Schema checks use mock inputs; no provider writes run. Approval registers a contract for the selected agent. Future calendar writes still require event approval.")
        OutlinedTextField(
            name,
            { name = it.take(100); validation = null },
            label = { Text("Skill name") },
            singleLine = true,
            enabled = !locked,
            modifier = Modifier.fillMaxWidth(),
        )
        inputs.forEachIndexed { i, (k, v) ->
            OutlinedTextField(
                v,
                { value -> inputs = inputs.toMutableList().also { it[i] = k to value.take(500) }; validation = null },
                label = { Text(k) },
                enabled = !locked,
                minLines = 1,
                maxLines = 4,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Column {
            OutlinedButton(enabled = !locked && agents.isNotEmpty(), onClick = { picking = true }) {
                Text("Target agent: ${agents.firstOrNull { it.first == target }?.second ?: "Choose"}")
            }
            DropdownMenu(expanded = picking, onDismissRequest = { picking = false }) {
                agents.forEach { (id, agentName) ->
                    DropdownMenuItem(text = { Text(agentName) }, onClick = { target = id; validation = null; picking = false })
                }
            }
        }
        Muted("Tools, approvals and recovery rules remain fixed for this recipe. Status: ${status ?: "Draft"}")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(enabled = !busy && target != 0, onClick = { act("validate") }) { Text("Validate contract and access") }
            TextButton(enabled = !busy && status == null && validation?.ready == true, onClick = { act("submit") }) { Text("Submit for governance review") }
            TextButton(enabled = !busy && status == "pending", onClick = { act("approve") }) { Text("Approve reviewed contract") }
        }
        validation?.let { v ->
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(if (v.ready) "Ready for governance review" else "Validation blockers", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                if (v.missingTools.isNotEmpty()) Text("Missing tools: ${v.missingTools.joinToString(", ")}", style = MaterialTheme.typography.bodySmall)
                v.checks.forEach { (label, passed) -> Text("$label: ${if (passed) "Passed" else "Failed"}", style = MaterialTheme.typography.bodySmall) }
                v.accessChecks.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                v.limitations.forEach { Muted(it) }
            }
        }
    }
}

/** On a calendar event that verifiably succeeded: export the operation as a skill draft. */
@Composable
fun ExportCalendarSkill(proposalId: Int, scope: SkillScope, skills: OperationSkills) {
    val key = "export-${scope.orgId}:${scope.roomKey}:$proposalId"
    var busy by remember(key) { mutableStateOf(false) }
    var failed by remember(key) { mutableStateOf(false) }
    var draft by remember(key) { mutableStateOf<OperationSkillDraft?>(null) }
    val launch = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (draft == null) {
            TextButton(enabled = !busy, onClick = {
                busy = true
                failed = false
                launch.launch {
                    skills.export(scope, proposalId).fold(onSuccess = { draft = it }, onFailure = { failed = true })
                    busy = false
                }
            }) { Text(if (busy) "Preparing draft…" else "Export as skill draft") }
        }
        if (failed) Text(
            "Could not export this operation. A verified email-to-calendar execution in this room is required.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
        )
        draft?.let { OperationSkillDraftCard(it, skills, scope) }
    }
}
