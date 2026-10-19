package app.oddjob.crew.ui.approvals

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.oddjob.crew.data.ApprovalInput
import app.oddjob.crew.data.ApprovalView
import app.oddjob.crew.data.Approvals
import app.oddjob.crew.data.CalendarConfirmation
import app.oddjob.crew.data.CrewJson
import app.oddjob.crew.data.DecisionOutcome
import app.oddjob.crew.data.OperationSkills
import app.oddjob.crew.data.ReadBack
import app.oddjob.crew.data.SkillScope
import app.oddjob.crew.ui.cards.CardSurface
import app.oddjob.crew.ui.cards.ExportCalendarSkill
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

/**
 * One approval request, decidable in place: in a CREW turn and in the inbox.
 *
 * [decided] is a decision already known from elsewhere (a later room message
 * that recorded it). [readBack] fetches the stored row, for kinds whose turn
 * snapshot goes stale once decided anywhere else. [onDecide] performs the
 * decision, with any edits to an outbound draft, and reports what the server
 * said; the card shows every outcome, including "someone decided first".
 */
@Composable
fun ApprovalCard(
    view: ApprovalView,
    stateKey: String,
    decided: String? = null,
    enabled: Boolean = true,
    readBack: (suspend (Int) -> ReadBack?)? = null,
    /** The person looking at the card; see [ApprovalView.awaitsAnotherApprover]. */
    viewerId: String? = null,
    /** Re-asks an approved calendar create for its outcome, without a second write; null where unavailable. */
    recheckCalendar: (suspend (Int) -> JsonObject?)? = null,
    /** Re-reads an approved calendar event from Google (GET …/calendar-verification); null where unavailable. */
    verifyCalendar: (suspend (Int) -> JsonObject?)? = null,
    /** Export of a verified calendar operation as a skill draft; null where unavailable (the inbox). */
    skills: OperationSkills? = null,
    onDecide: suspend (approved: Boolean, code: String?, edits: Map<String, String>) -> DecisionOutcome,
) {
    var status by rememberSaveable(stateKey) { mutableStateOf(decided ?: view.status) }
    var note by rememberSaveable(stateKey) { mutableStateOf<String?>(null) }
    var error by rememberSaveable(stateKey) { mutableStateOf<String?>(null) }
    var code by rememberSaveable(stateKey) { mutableStateOf("") }
    var submitting by rememberSaveable(stateKey) { mutableStateOf(false) }
    // Tool results and send results, kept as JSON text so they survive recomposition and rotation.
    var actionJson by rememberSaveable(stateKey) { mutableStateOf<String?>(null) }
    var sendFailed by rememberSaveable(stateKey) { mutableStateOf<String?>(null) }
    // The outbound draft as stored (after any edit) and this person's edits.
    var body by rememberSaveable(stateKey) { mutableStateOf(view.body.orEmpty()) }
    var subject by rememberSaveable(stateKey) { mutableStateOf(view.subject.orEmpty()) }
    var editing by rememberSaveable(stateKey) { mutableStateOf(false) }
    var editedBody by rememberSaveable(stateKey) { mutableStateOf("") }
    var editedSubject by rememberSaveable(stateKey) { mutableStateOf("") }
    var verification by rememberSaveable(stateKey) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    val action = actionJson?.let { runCatching { CrewJson.parseToJsonElement(it).jsonObject }.getOrNull() }

    fun absorbAction(result: JsonObject?) {
        if (result == null) return
        actionJson = result.toString()
        val failed = (result["success"] as? JsonPrimitive)?.contentOrNull == "false" ||
            // A pipeline run's stored outcome carries a state, not success.
            (view.kind == "pipeline_run" && (result["state"] as? JsonPrimitive)?.contentOrNull == "failed")
        // An executing or unknown calendar create is not a failure yet: the recovery box below says so.
        if (failed && calendarPending(result) == null) {
            val prefix = when (view.kind) {
                "amazon_purchase" -> "Amazon handoff failed: "
                "flighthub_booking" -> ""
                "pipeline_run" -> "Run failed: "
                "app_record_action" -> "App action failed: "
                else -> "Google change failed: "
            }
            error = prefix + ((result["error"] as? JsonPrimitive)?.contentOrNull ?: "unknown error")
        }
    }

    // A room message recording the decision can arrive after the card is shown.
    LaunchedEffect(decided) { if (decided != null) status = decided }
    // The turn artifact is a snapshot; the row says what actually happened.
    LaunchedEffect(view.id) {
        val id = view.id ?: return@LaunchedEffect
        if (!view.readsBack || readBack == null) return@LaunchedEffect
        val row = readBack(id) ?: return@LaunchedEffect
        if (row.status == "approved" || row.status == "rejected") status = row.status
        absorbAction(row.action)
        row.sendResult?.let { r -> if ((r["sent"] as? JsonPrimitive)?.contentOrNull == "false") sendFailed = (r["error"] as? JsonPrimitive)?.contentOrNull ?: "unknown error" }
        row.body?.let { body = it }
        row.subject?.let { subject = it }
    }

    val edits: Map<String, String> = if (!editing) emptyMap() else buildMap {
        if (editedBody != body) put("body", editedBody)
        if (editedSubject != subject) put("subject", editedSubject)
    }

    fun decide(approved: Boolean) {
        if (approved && view.input == ApprovalInput.Code && code.isBlank()) {
            error = "Enter the verification code before approving."
            return
        }
        submitting = true
        error = null
        scope.launch {
            when (val outcome = onDecide(approved, code.takeIf { view.input == ApprovalInput.Code }, if (approved) edits else emptyMap())) {
                is DecisionOutcome.Recorded -> {
                    status = outcome.status
                    note = outcome.assembly?.let { assemblyLine(it) }
                    absorbAction(outcome.action)
                    outcome.outbound?.let { r ->
                        if ((r["sent"] as? JsonPrimitive)?.contentOrNull == "false") sendFailed = (r["error"] as? JsonPrimitive)?.contentOrNull ?: "unknown error"
                    }
                    if (approved && editing) {
                        body = editedBody
                        subject = editedSubject
                    }
                    editing = false
                }
                is DecisionOutcome.AlreadyDecided -> {
                    status = outcome.status
                    note = "Someone decided this before you."
                }
                is DecisionOutcome.Failed -> error = outcome.message
            }
            submitting = false
        }
    }

    CardSurface {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    if (view.isOutbound) (view.sensitivityLabelOrNull() ?: "OUTBOUND MESSAGE") else view.kind.replace('_', ' ').uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.tertiary,
                )
                Text(
                    view.statusLabel(status, sendFailed != null).uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = when {
                        sendFailed != null -> MaterialTheme.colorScheme.error
                        status == "approved" -> MaterialTheme.colorScheme.primary
                        status == "rejected" -> MaterialTheme.colorScheme.error
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
            Text(view.heading, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            if (!view.isOutbound) view.reason?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }

            view.section?.let { Text(it, style = MaterialTheme.typography.labelLarge) }
            view.details.forEach { (label, value) ->
                if (view.isOutbound && label == "Subject") return@forEach
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(value, style = MaterialTheme.typography.bodySmall)
                }
            }

            if (view.isOutbound) {
                val canEdit = status == "pending" && enabled && !submitting
                if (editing && canEdit) {
                    if (view.channel == "email") {
                        OutlinedTextField(editedSubject, { editedSubject = it }, label = { Text("Subject") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    }
                    OutlinedTextField(editedBody, { editedBody = it }, label = { Text("Message") }, minLines = 4, maxLines = 12, modifier = Modifier.fillMaxWidth())
                } else {
                    if (view.channel == "email") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Subject", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(subject.ifBlank { "(no subject)" }, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                        }
                    }
                    // The message itself, exactly as it would be sent.
                    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth()) {
                        Text(body, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(10.dp))
                    }
                }
                view.reason?.let { Muted(it) }
                if (status == "pending") {
                    TextButton(enabled = canEdit, onClick = {
                        if (!editing) { editedBody = body; editedSubject = subject }
                        editing = !editing
                    }) { Text(if (editing) "Cancel edits" else "Edit draft") }
                }
                sendFailed?.let { Text("Delivery failed: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
            } else {
                view.body?.let {
                    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth()) {
                        Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(10.dp))
                    }
                }
            }
            view.note?.takeIf { !view.noteWhilePending || status == "pending" }?.let { Muted(it) }
            view.calendarWorkflow?.line?.let { Muted(it) }
            outcomeLine(view, action)?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            }
            val createsEvent = view.kind == "calendar_action" && view.actionName == "gcal_create_event"
            val succeeded = action != null && (action["success"] as? JsonPrimitive)?.contentOrNull == "true" &&
                (action["discarded"] as? JsonPrimitive)?.contentOrNull != "true"
            if (succeeded && view.kind in setOf("calendar_action", "google_workspace_action")) {
                Text(
                    when {
                        createsEvent -> "Calendar event added."
                        view.kind == "calendar_action" -> "Calendar change applied."
                        else -> "Google Workspace change applied."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                val event = (action?.get("result") as? JsonObject)?.let { CalendarConfirmation.parse(it, view.calendarId) }
                if (view.kind == "calendar_action" && event != null) {
                    event.summary?.let { Text(it, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium) }
                    event.lines().forEach { (label, value) ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(value, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        event.link?.let { url -> OutlinedButton(onClick = { uriHandler.openUri(url) }) { Text("Open event") } }
                        if (createsEvent && verifyCalendar != null && view.id != null) {
                            OutlinedButton(enabled = !submitting, onClick = {
                                submitting = true
                                scope.launch {
                                    verification = CalendarConfirmation.verificationLine(runCatching { verifyCalendar(view.id) })
                                    submitting = false
                                }
                            }) { Text("Verify in Google") }
                        }
                    }
                    verification?.let { Muted(it) }
                }
            }
            // Approved, but the create's outcome is not confirmed: check it rather than creating another.
            if (createsEvent && status == "approved" && !succeeded && (action == null || calendarPending(action) != null)) {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            if (action != null && calendarPending(action) == "executing") "Calendar change is executing."
                            else "Calendar outcome is unconfirmed. Check the existing event before creating another.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        if (recheckCalendar != null && view.id != null) {
                            OutlinedButton(enabled = !submitting, onClick = {
                                submitting = true
                                error = null
                                scope.launch {
                                    val result = runCatching { recheckCalendar(view.id) }
                                    val outcome = result.getOrNull()
                                    when {
                                        outcome == null -> error = result.exceptionOrNull()?.message ?: "Calendar outcome could not be checked."
                                        else -> {
                                            actionJson = outcome.toString()
                                            if ((outcome["success"] as? JsonPrimitive)?.contentOrNull != "true") {
                                                error = (outcome["error"] as? JsonPrimitive)?.contentOrNull ?: "Calendar outcome remains unconfirmed."
                                            }
                                        }
                                    }
                                    submitting = false
                                }
                            }) { Text("Check calendar outcome") }
                        }
                    }
                }
            }
            val workflow = view.calendarWorkflow
            if (createsEvent && succeeded && (action?.get("state") as? JsonPrimitive)?.contentOrNull == "succeeded" &&
                skills != null && view.id != null && !view.unpersisted && workflow?.sessionKey != null && workflow.organizationId != null
            ) {
                ExportCalendarSkill(view.id, SkillScope(workflow.sessionKey, workflow.organizationId), skills)
            }
            Approvals.handoffLink(view, action)?.let { (label, url) ->
                OutlinedButton(onClick = { uriHandler.openUri(url) }) { Text(label) }
            }
            view.requestedBy?.let {
                Text(
                    if (view.isOutbound) "Drafted by @$it" else "Requested by @$it",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            note?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }

            if (status == "pending") {
                when {
                    view.unpersisted -> Muted("This proposal was never persisted, so it cannot be approved. Ask the room to raise it again.")
                    view.input is ApprovalInput.WebOnly -> Muted("Decide this one in Oddjob on the web. ${view.input.why}")
                    view.awaitsAnotherApprover(viewerId) -> Muted("Waiting for an Executive on this project to approve.")
                    else -> {
                        if (view.input == ApprovalInput.Code) {
                            OutlinedTextField(
                                code,
                                { code = it },
                                label = { Text("Verification code") },
                                singleLine = true,
                                enabled = enabled && !submitting,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { decide(true) }, enabled = enabled && !submitting, modifier = Modifier.weight(1f)) {
                                Text(
                                    when {
                                        submitting -> "Working…"
                                        edits.isNotEmpty() -> if (view.channel == "slack") "Post edited" else "Send edited"
                                        else -> view.approveLabel
                                    },
                                )
                            }
                            OutlinedButton(onClick = { decide(false) }, enabled = enabled && !submitting, modifier = Modifier.weight(1f)) {
                                Text(view.rejectLabel)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** What an approved pipeline run or app record change did, in the web card's words; failures show as errors. */
private fun outcomeLine(view: ApprovalView, action: JsonObject?): String? {
    if (action == null) return null
    fun str(key: String) = (action[key] as? JsonPrimitive)?.contentOrNull
    return when (view.kind) {
        "pipeline_run" -> when {
            str("state") == "failed" || str("status") == "failed" -> null
            str("state") == "succeeded" -> "Run finished" + (str("executionId")?.let { " (execution #$it)" } ?: "") + "."
            str("state") == "running" || str("status") == "started" -> "Run started."
            else -> null
        }
        "app_record_action" -> when {
            str("error") != null -> null
            str("discarded") == "true" -> "Change was discarded."
            str("success") != "true" -> null
            view.appAction == "delete_record" -> "Record deleted."
            else -> "Record ${if (view.appAction == "update_record") "updated" else "created"} (${str("recordId") ?: view.recordId ?: "new"})."
        }
        else -> null
    }
}

/** "executing" or "outcome_unknown" for a calendar create still being settled; null otherwise. */
private fun calendarPending(action: JsonObject): String? =
    (action["state"] as? JsonPrimitive)?.contentOrNull?.takeIf { it == "executing" || it == "outcome_unknown" }

private fun ApprovalView.sensitivityLabelOrNull(): String? =
    details.firstOrNull { it.first == "Sensitivity" }?.second?.let { Approvals.sensitivityLabel(it.replace(' ', '_')).uppercase() }

@Composable
private fun Muted(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** The scaffold result an approved app deployment returns, in one line. */
private fun assemblyLine(assembly: JsonObject): String {
    val get = { k: String -> (assembly[k] as? JsonPrimitive)?.content }
    return if (get("success") == "true") "Built ${get("displayName") ?: get("appName") ?: "the app"}."
    else "The scaffold failed: ${get("error") ?: "unknown error"}."
}
