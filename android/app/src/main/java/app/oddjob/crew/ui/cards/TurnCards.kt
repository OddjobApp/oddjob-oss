package app.oddjob.crew.ui.cards

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.oddjob.crew.data.ApprovalView
import app.oddjob.crew.data.Approvals
import app.oddjob.crew.data.Carousel
import app.oddjob.crew.data.CrewReview
import app.oddjob.crew.data.DecisionOutcome
import app.oddjob.crew.data.GmailDirective
import app.oddjob.crew.data.GovernanceCheckpoint
import app.oddjob.crew.data.ReadBack
import app.oddjob.crew.data.RecordCard
import app.oddjob.crew.data.TurnArtifact
import app.oddjob.crew.data.Workspace
import app.oddjob.crew.data.WorkspaceAction
import app.oddjob.crew.data.WorkspaceResults
import app.oddjob.crew.data.WorkspaceSelection
import app.oddjob.crew.ui.approvals.ApprovalCard
import app.oddjob.crew.forms.FormSpec
import app.oddjob.crew.forms.FormSpecs
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** How the phone shows one turn artifact. */
sealed interface CardKind {
    data class Form(val spec: FormSpec) : CardKind
    data class Approval(val view: ApprovalView) : CardKind
    data class Results(val results: WorkspaceResults) : CardKind
    data class Review(val review: CrewReview) : CardKind
    data class Record(val card: RecordCard) : CardKind
    data class Governance(val checkpoint: GovernanceCheckpoint) : CardKind
    data class Directive(val directive: GmailDirective) : CardKind
    data class Directives(val directives: List<GmailDirective>) : CardKind
    data class WorkProductNotice(val title: String, val changeSummary: String?) : CardKind
    data class CarouselCard(val carousel: Carousel) : CardKind
    data class Map(val data: app.oddjob.crew.data.MapCardData) : CardKind
    data class Files(val files: app.oddjob.crew.data.RoomFiles) : CardKind
    /** An agent asking the person for information (a HIL form request). */
    data class InputRequest(val spec: FormSpec, val requestId: Int?) : CardKind
    data class Image(val url: String, val title: String?, val description: String?) : CardKind
    /** Procedures loaded into the agent's prompt: provenance, not execution. */
    data class Guidance(val receipt: app.oddjob.crew.data.GuidanceReceipt) : CardKind
    data class ImportedSkills(val receipt: app.oddjob.crew.data.ImportedSkillReceipt) : CardKind
    data class OperationSkill(val draft: app.oddjob.crew.data.OperationSkillDraft) : CardKind
    /** A refused call the person can act on: the steps to access and who can take them. */
    data class Permission(val card: app.oddjob.crew.data.PermissionRequired) : CardKind
    /** A Granola search whose matches only the asker can see and share. */
    data class GranolaPrivate(val card: app.oddjob.crew.data.GranolaPrivateResults) : CardKind
    /** Studios, pods, rails and app mounts: out of scope on mobile. */
    data class Studio(val name: String) : CardKind
    /** A chat surface without a native renderer yet. */
    data class Unsupported(val title: String?, val type: String) : CardKind
}

/** What a card can do in its room, gathered so each card takes only what it needs. */
class TurnCardActions(
    val enabled: Boolean,
    val selected: List<WorkspaceSelection>,
    /** A reply the card posts to the room on the person's behalf. */
    val onSubmit: (String) -> Unit,
    val onDecideApproval: suspend (ApprovalView, Boolean, String?, Map<String, String>) -> DecisionOutcome,
    val readApproval: suspend (Int) -> ReadBack?,
    val onSelect: (turnId: Int, tool: String, resultIndex: Int, items: List<WorkspaceSelection>) -> Unit,
    val onAct: (List<WorkspaceSelection>, WorkspaceAction) -> Unit,
    val onChangeRecord: suspend (RecordCard, String) -> String?,
    val onOpenWorkProduct: () -> Unit,
    val resolveUrl: (String) -> String,
    val mapLocation: MapLocationPrefs,
    /** The room's org, sent with file requests so a room outside the session's default org resolves. */
    val orgId: Int? = null,
    val downloadFile: suspend (Int) -> Result<ByteArray> = { Result.failure(IllegalStateException("unavailable")) },
    val saveSnapshot: suspend (sessionKey: String, id: String, orgId: Int?) -> String? = { _, _, _ -> "unavailable" },
    /**
     * Answers an input request, then posts [message] to the room. Null on success,
     * else why it was not submitted: an unrecorded answer is never announced.
     */
    val answerInputRequest: suspend (requestId: Int?, message: String, data: JsonObject) -> String? = { _, message, _ -> onSubmit(message); null },
    /** The signed-in person, so a request routed to someone else's approval offers them no buttons. */
    val currentUserId: String? = null,
    /** The room a skill draft is reviewed in, and the calls that export and review it. */
    val skillScope: app.oddjob.crew.data.SkillScope? = null,
    val skills: app.oddjob.crew.data.OperationSkills? = null,
    /** Re-asks an approved calendar create for its outcome, without a second write. */
    val recheckCalendar: (suspend (Int) -> JsonObject?)? = null,
    /** Re-reads an approved calendar event from Google. */
    val verifyCalendar: (suspend (Int) -> JsonObject?)? = null,
    /** The asker's own Granola matches for a private search, and sharing one into the room (null on success). */
    val granolaMeetings: suspend (app.oddjob.crew.data.GranolaPrivateResults) -> Result<List<app.oddjob.crew.data.GranolaMeeting>> =
        { Result.failure(IllegalStateException("unavailable")) },
    val shareGranola: suspend (app.oddjob.crew.data.GranolaPrivateResults, String) -> String? = { _, _ -> "Sharing is unavailable here." },
)

object TurnCards {
    private val studioTypes = setOf(
        "assistant_app", "builder_pod", "scribe_foundry_pod", "scribe_stations_configured",
        "media_config_surface", "media_config", "media_take_proposal",
    )

    /** Desktop rails a turn can mount: an interactive matrix or timeline that needs the web's canvas. */
    private val railTypes = setOf("crew_decision_matrix_pod", "crew_forensic_timeline_pod")
    private val railModules = setOf("CrewDecisionMatrixRail", "DecisionMatrixPod", "CrewForensicTimelineRail")
    private val railTools = setOf("propose_decision_matrix", "pin_forensic_event")

    private fun JsonObject.str(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull

    fun classify(artifact: TurnArtifact): CardKind {
        val p = artifact.payload ?: JsonObject(emptyMap())
        val type = p.str("type").orEmpty()
        when (type) {
            "assistant_form" -> FormSpecs.parse(p)?.let { return CardKind.Form(it) }
            "approval_request" -> return CardKind.Approval(Approvals.fromCard(p))
            "google_workspace_results" -> Workspace.parse(p)?.let { return CardKind.Results(it) }
            "performance_scorecard", "gate_review" -> CrewReview.parse(p)?.let { return CardKind.Review(it) }
            "gmail_directive" -> GmailDirective.parse(p)?.let { return CardKind.Directive(it) }
            "gmail_directive_list" -> return CardKind.Directives(GmailDirective.list(p))
            "crew_work_product" -> return CardKind.WorkProductNotice(p.str("title") ?: "Work product", p.str("changeSummary"))
            "assistant_carousel" -> Carousel.parse(p)?.let { return CardKind.CarouselCard(it) }
            "assistant_map", "map" -> app.oddjob.crew.data.MapCardData.parse(p)?.let { return CardKind.Map(it) }
            "room_attachments" -> app.oddjob.crew.data.RoomFiles.parse(p)?.let { return CardKind.Files(it) }
            // Same field shape as a chat form; the parser keys on the chat-form type.
            "input_request" -> FormSpecs.parse(JsonObject(p + ("type" to JsonPrimitive("assistant_form"))))?.let { return CardKind.InputRequest(it, (p["requestId"] as? JsonPrimitive)?.contentOrNull?.toIntOrNull()) }
            "crew_guidance_receipt" -> app.oddjob.crew.data.GuidanceReceipt.parse(p)?.let { return CardKind.Guidance(it) }
            "crew_imported_skill_receipt" -> app.oddjob.crew.data.ImportedSkillReceipt.parse(p)?.let { return CardKind.ImportedSkills(it) }
            "crew_operation_skill_draft" -> app.oddjob.crew.data.OperationSkillDraft.parse(p)?.let { return CardKind.OperationSkill(it) }
            "assistant_image" -> p.str("url")?.takeIf { it.startsWith("https://") || it.startsWith("/") }
                ?.let { return CardKind.Image(it, p.str("title"), p.str("description")) }
            "permission_required" -> app.oddjob.crew.data.PermissionRequired.parse(p)?.let { return CardKind.Permission(it) }
            "granola_private_results" -> app.oddjob.crew.data.GranolaPrivateResults.parse(p)?.let { return CardKind.GranolaPrivate(it) }
        }
        val component = p.str("module") ?: p.str("component") ?: p.str("componentName") ?: p.str("podComponent")
        if (type in railTypes || component in railModules || artifact.tool in railTools) {
            return CardKind.Studio(p.str("title") ?: p.str("incidentTitle") ?: if (type.contains("forensic") || artifact.tool == "pin_forensic_event") "Forensic timeline" else "Decision matrix")
        }
        RecordCard.parse(artifact.tool, p)?.let { return CardKind.Record(it) }
        GovernanceCheckpoint.parse(artifact.tool, p)?.let { return CardKind.Governance(it) }
        val isInstantApp = type == "instant_app" || type == "instant_app_surface"
        val isStudio = !isInstantApp && (
            artifact.tool.startsWith("mount_") || type.endsWith("_studio_pod") || type.endsWith("_pod") ||
                type in studioTypes || component?.endsWith("StudioPod") == true
            )
        if (isStudio) return CardKind.Studio(studioName(p.str("title"), type, component))
        return CardKind.Unsupported(p.str("title"), type.ifEmpty { artifact.tool })
    }

    private fun studioName(title: String?, type: String, component: String?): String {
        title?.takeIf { it.isNotBlank() }?.let { return it }
        val raw = component?.removeSuffix("Pod")?.replace(Regex("([a-z])([A-Z])"), "$1 $2")
            ?: type.removeSuffix("_pod").split('_').joinToString(" ") { it.replaceFirstChar(Char::uppercase) }
        return raw.ifBlank { "Studio" }
    }

    /**
     * The web shows the first of artifacts sharing a tool and a module, title,
     * chart or type (TurnRow's filter), except result lists, which are all shown.
     */
    fun dedupe(artifacts: List<TurnArtifact>): List<TurnArtifact> = artifacts.filterIndexed { idx, artifact ->
        artifact.payload?.str("type") == "google_workspace_results" || idx == artifacts.indexOfFirst { a ->
            a.tool == artifact.tool && listOf("module", "title", "chart", "type").any { k ->
                val x = a.payload?.str(k)
                x != null && x == artifact.payload?.str(k)
            }
        }
    }

    /** Text for the turn's copy button: what each card shows, without its controls. */
    fun copyText(artifact: TurnArtifact): String? = when (val card = classify(artifact)) {
        is CardKind.Results -> Workspace.copyText(card.results)
        is CardKind.Directive -> with(card.directive) {
            listOfNotNull(
                "Gmail sender alert", "Status: $statusLabel", "From: $sender", mailbox?.let { "Connected mailbox: $it" },
                "Checks every $intervalSeconds seconds · No recurring AI calls · Notifications enabled when active",
            ).joinToString("\n")
        }
        is CardKind.OperationSkill -> card.draft.markdown()
        is CardKind.Directives -> (listOf("Your Gmail directives") + card.directives.map { d ->
            listOfNotNull("From: ${d.sender}", "Status: ${d.statusLabel}", d.mailbox?.let { "Connected mailbox: $it" }, "Last checked: ${d.lastCheckedAt ?: "Not yet"}", d.error)
                .joinToString("\n")
        }).joinToString("\n\n")
        else -> null
    }
}

/** The artifacts under a turn's text. [laterUserTurns] lets a form or approval see it was already answered. */
@Composable
fun TurnArtifacts(
    turnId: Int,
    artifacts: List<TurnArtifact>,
    laterUserTurns: List<String>,
    actions: TurnCardActions,
) {
    val deduped = remember(artifacts) { TurnCards.dedupe(artifacts) }
    val cards = remember(deduped) { deduped.map(TurnCards::classify) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        cards.forEachIndexed { i, card ->
            when (card) {
                is CardKind.Form -> {
                    val prefix = FormSpecs.submissionPrefix(card.spec)
                    FormCard(
                        spec = card.spec,
                        stateKey = "form-$turnId-$i",
                        alreadySubmitted = laterUserTurns.any { it.startsWith(prefix) },
                        enabled = actions.enabled,
                        onSubmit = actions.onSubmit,
                    )
                }
                is CardKind.Approval -> ApprovalCard(
                    view = card.view,
                    stateKey = "approval-$turnId-$i",
                    decided = Approvals.decidedInRoom(card.view, laterUserTurns),
                    enabled = actions.enabled,
                    readBack = actions.readApproval,
                    viewerId = actions.currentUserId,
                    recheckCalendar = actions.recheckCalendar,
                    verifyCalendar = actions.verifyCalendar,
                    // Once this turn holds the exported draft, the draft card below is the one to use.
                    skills = actions.skills.takeIf { cards.none { it is CardKind.OperationSkill } },
                    onDecide = { approved, code, edits -> actions.onDecideApproval(card.view, approved, code, edits) },
                )
                is CardKind.Results -> WorkspaceResultCard(
                    results = card.results,
                    turnId = turnId,
                    tool = deduped[i].tool,
                    // The web numbers result lists by their position among the turn's shown cards.
                    resultIndex = i,
                    selected = actions.selected,
                    enabled = actions.enabled,
                    onSelect = { items -> actions.onSelect(turnId, deduped[i].tool, i, items) },
                    onAct = actions.onAct,
                    onMore = actions.onSubmit,
                    saveSnapshot = actions.saveSnapshot,
                )
                is CardKind.Review -> ReviewCard(card.review)
                is CardKind.Record -> RecordCardView(card.card, "record-$turnId-$i", actions.enabled, actions.onChangeRecord)
                is CardKind.Governance -> GovernanceCard(card.checkpoint)
                is CardKind.Directive -> GmailDirectiveCard(card.directive, actions.enabled, actions.onSubmit)
                is CardKind.Directives -> GmailDirectiveListCard(card.directives, actions.enabled, actions.onSubmit)
                is CardKind.WorkProductNotice -> WorkProductNote(card.title, card.changeSummary, actions.onOpenWorkProduct)
                is CardKind.CarouselCard -> CarouselCard(card.carousel, actions.resolveUrl)
                is CardKind.Map -> MapCard(card.data, actions.mapLocation)
                is CardKind.Files -> FilesCard(card.files, actions)
                is CardKind.InputRequest -> {
                    // The web words an input request's answer "… form with:", unlike a chat form.
                    val prefix = "I submitted the \"${card.spec.title ?: "form"}\" form with:"
                    FormCard(
                        spec = card.spec,
                        stateKey = "input-$turnId-$i",
                        alreadySubmitted = laterUserTurns.any { it.startsWith(prefix) },
                        enabled = actions.enabled,
                        onSubmit = {},
                        submitChecked = { message ->
                            val json = message.substringAfter(" with: ", "{}")
                            val data = runCatching { app.oddjob.crew.data.CrewJson.parseToJsonElement(json) as JsonObject }.getOrNull() ?: JsonObject(emptyMap())
                            actions.answerInputRequest(card.requestId, "$prefix $json", data)
                        },
                    )
                }
                is CardKind.Image -> GeneratedImageCard(card, actions)
                is CardKind.Guidance -> GuidanceReceiptCard(card.receipt, "guidance-$turnId-$i")
                is CardKind.ImportedSkills -> ImportedSkillReceiptCard(card.receipt, "imported-$turnId-$i")
                is CardKind.OperationSkill -> OperationSkillDraftCard(card.draft, actions.skills, actions.skillScope)
                is CardKind.Permission -> PermissionRequiredCard(card.card, actions.resolveUrl)
                is CardKind.GranolaPrivate -> GranolaPrivateResultsCard(card.card, actions.currentUserId, actions.granolaMeetings, actions.shareGranola)
                is CardKind.Studio -> NoteLine("${card.name} · opens in Oddjob on desktop")
                is CardKind.Unsupported -> NoteLine("${card.title ?: card.type.replace('_', ' ')} · not shown on mobile yet")
            }
        }
    }
}

@Composable
private fun NoteLine(text: String) {
    Text(text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
fun CardSurface(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.medium,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp), content = content)
    }
}
