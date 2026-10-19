package app.oddjob.crew.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

/*
 * Approval requests, as the phone shows and decides them.
 *
 * Two sources feed one view: an `approval_request` card in a CREW turn (the
 * payload a proposal tool returned), and an inbox row from GET /api/approvals
 * (the approval_requests row, whose proposal envelope sits on modifiedOutput or
 * toolArgs). Classification mirrors client/src/components/agent-chat/
 * InlineApprovalCard.tsx so the same request asks the same thing on both.
 */

/** What deciding needs beyond a tap. */
sealed interface ApprovalInput {
    data object None : ApprovalInput
    /** A one-time or verification code, sent as `modifiedOutput.solution`. */
    data object Code : ApprovalInput
    /** Something the phone cannot collect (an image to click, a form stage). */
    data class WebOnly(val why: String) : ApprovalInput
}

data class ApprovalView(
    /** The approval_requests id; null when the card has none to decide. */
    val id: Int?,
    /** A proposal whose insert failed: its id is a timestamp, not a row. */
    val unpersisted: Boolean,
    val kind: String,
    val title: String,
    val reason: String?,
    val requestedBy: String?,
    val status: String,
    /** Labelled facts shown above the buttons, in order. */
    val details: List<Pair<String, String>>,
    /** Long text shown as-is: the message an outbound_message would send. */
    val body: String?,
    val input: ApprovalInput,
    /** Heading over [details] for a proposal that runs a tool: "Review calendar change". */
    val section: String? = null,
    /** What approving does and does not do, for handoffs a person completes elsewhere. */
    val note: String? = null,
    /** outbound_message only: "email" or "slack", its subject and recipients. */
    val channel: String? = null,
    val subject: String? = null,
    val to: List<String> = emptyList(),
    /** The tool a quickbooks_action runs (quickbooks_create_invoice, …_record_payment, …). */
    val actionName: String? = null,
    /**
     * A QuickBooks void, refund or outgoing payment goes to the project's
     * Executives (shared/finance-roles.ts), and [proposedBy] cannot approve it.
     */
    val needsExecutive: Boolean = false,
    val proposedBy: String? = null,
    /** calendar_action only: the verified email → calendar workflow the proposal came from. */
    val calendarWorkflow: CalendarWorkflow? = null,
    /** Shown in place of [title] as the card's heading; the room line still names [title], as on the web. */
    val displayTitle: String? = null,
    /** [note] only applies while the request is undecided ("nothing runs until…"). */
    val noteWhilePending: Boolean = false,
    /** pipeline_run only: the pipeline the run would start. */
    val pipelineName: String? = null,
    /** app_record_action only: the app, its collection, and create_record / update_record / delete_record. */
    val appName: String? = null,
    val collection: String? = null,
    val appAction: String? = null,
    val recordId: String? = null,
    /** calendar_action only: the calendar the event goes into, for the confirmation. */
    val calendarId: String? = null,
) {
    /** True when [viewerId] asked for this and an Executive must decide it, so they get no buttons. */
    fun awaitsAnotherApprover(viewerId: String?): Boolean = needsExecutive && viewerId != null && proposedBy == viewerId

    val pending: Boolean get() = status == "pending"
    val isOutbound: Boolean get() = kind == "outbound_message"
    /** Kinds whose real outcome lives on the approval row, so a turn card re-reads it (InlineApprovalCard does too). */
    val readsBack: Boolean get() = id != null && (isOutbound || kind in outcomeKinds)

    /** The header line: an outbound message reads as the message it is. */
    val heading: String get() = when {
        isOutbound -> if (channel == "slack") "Slack message" else "New email"
        else -> displayTitle ?: title
    }

    fun statusLabel(status: String, sendFailed: Boolean = false): String = when {
        !isOutbound -> status
        status == "pending" -> "Ready to send"
        status == "rejected" -> "Discarded"
        sendFailed -> "Send failed"
        else -> "Sent"
    }

    val approveLabel: String get() = when {
        input != ApprovalInput.None -> "Submit & resume"
        isOutbound -> if (channel == "slack") "Post message" else "Send email"
        else -> "Approve"
    }
    val rejectLabel: String get() = if (isOutbound) "Discard" else "Reject"
}

/** Proposals that execute a tool on approval and report its result on the row. */
private val actionKinds = setOf("calendar_action", "google_workspace_action", "amazon_purchase", "flighthub_booking", "quickbooks_action")

/** Proposals whose approval starts or writes something and stores the outcome on the row. */
private val outcomeKinds = actionKinds + setOf("pipeline_run", "app_record_action")

/** "create_record" → "create record", as the web names an app action. */
internal fun appActionLabel(action: String?): String? = action?.replace('_', ' ')

private val sensitivityLabels = mapOf(
    "routine" to "Routine",
    "requested_review" to "Requested review",
    "external_first_contact" to "First contact",
    "customer_facing" to "Customer-facing",
    "commitment_or_legal" to "Commitment / legal",
    "broad_audience" to "Broad audience",
)

private val otpTypes = setOf("2fa", "mfa", "two_factor_auth", "verification_code")

private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject

/** A string or a list of strings, joined for display. */
private fun JsonObject.list(key: String): String? = when (val v = this[key]) {
    is JsonArray -> v.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.filter { it.isNotBlank() }.joinToString(", ").ifEmpty { null }
    is JsonPrimitive -> v.contentOrNull?.takeIf { it.isNotBlank() }
    else -> null
}

/** proposalId is usually a row id; the web treats anything past 1e12 as a Date.now() placeholder. */
private const val UNPERSISTED_FLOOR = 1_000_000_000_000L

private fun idOf(element: JsonElement?): Long? = (element as? JsonPrimitive)?.let { it.longOrNull ?: it.contentOrNull?.toLongOrNull() }

object Approvals {
    /** An approval_request card in a CREW turn. */
    fun fromCard(payload: JsonObject): ApprovalView {
        val raw = idOf(payload["proposalId"]) ?: idOf(payload["id"])
        return build(payload, raw, fallbackTitle = null, fallbackReason = null, status = payload.str("status") ?: "pending")
    }

    /** A row from GET /api/approvals. */
    fun fromInbox(row: JsonObject): ApprovalView {
        val envelope = row.obj("modifiedOutput") ?: row.obj("toolArgs") ?: JsonObject(emptyMap())
        return build(
            envelope,
            idOf(row["id"]),
            fallbackTitle = row.str("stepName"),
            fallbackReason = row.str("comments"),
            status = row.str("status") ?: "pending",
        )
    }

    private fun build(p: JsonObject, rawId: Long?, fallbackTitle: String?, fallbackReason: String?, status: String): ApprovalView {
        val context = p.obj("context") ?: JsonObject(emptyMap())
        val type = p.str("type")
        val contextType = context.str("type")
        val isCaptcha = type == "captcha_solution" || contextType == "captcha_solution" || p.str("kind") == "captcha_solution"
        val isOtp = type in otpTypes || contextType in otpTypes
        val isChallenge = isCaptcha || isOtp || type == "security_challenge" || contextType == "security_challenge" ||
            p.str("kind") == "security_challenge"
        val kind = p.str("kind") ?: when {
            isCaptcha -> "captcha_solution"
            type == "mission_proposal" -> "mission_proposal"
            else -> "approval_request"
        }

        val title = p.str("title") ?: fallbackTitle ?: when {
            isChallenge && isOtp -> "Two-Factor Authentication / Security Code"
            isChallenge -> "Solve CAPTCHA / Security Challenge"
            p.str("missionName") != null -> "Launch Mission: ${p.str("missionName")}"
            else -> "Approval Request"
        }
        val reason = p.str("reason") ?: p.str("description") ?: fallbackReason ?: when {
            isChallenge && context.str("goal") != null -> "Agent was working on: \"${context.str("goal")}\". Please solve the security verification to resume."
            isChallenge -> "Verification challenge detected during automation."
            else -> null
        }

        val input = when {
            isOtp -> ApprovalInput.Code
            isChallenge -> ApprovalInput.WebOnly("It has a challenge image to solve.")
            kind == "form_stage" -> ApprovalInput.WebOnly("It is a form stage; approving it without the answers would skip the stage.")
            else -> ApprovalInput.None
        }

        val details = buildList {
            if (kind == "outbound_message") {
                p.str("channel")?.let { add("Channel" to it.replaceFirstChar(Char::uppercase)) }
                p.list("to")?.let { add("To" to it) }
                p.list("cc")?.let { add("Cc" to it) }
                p.str("from")?.let { add("From" to it) }
                p.str("subject")?.let { add("Subject" to it) }
                p.str("thread")?.let { add("Thread" to it) }
                p.str("sensitivity")?.let { add("Sensitivity" to it.replace('_', ' ')) }
                p.str("trigger")?.let { add("Context" to it) }
            }
            p.list("scaffoldPacks")?.let { add("Scaffold packs" to it) }
            if (kind == "assembly_deployment") add("Theme" to (p.str("designStyleId") ?: "as proposed"))
            val args = p.obj("args")
            when (kind) {
                "google_workspace_action", "calendar_action" -> addAll(ApprovalArgs.fields(args))
                "amazon_purchase" -> addAll(ApprovalArgs.fields(args).filter { it.first != "Cart url" })
                "quickbooks_action" -> addAll(quickBooksDetails(p))
                "pipeline_run" -> {
                    add("Pipeline" to "${p.str("pipelineName") ?: "Pipeline"} (#${p.str("pipelineId") ?: "?"})")
                    addAll(ApprovalArgs.fields(p.obj("inputData")))
                }
                "app_record_action" -> {
                    add("Action" to (appActionLabel(p.str("action"))?.replaceFirstChar(Char::uppercase) ?: "Change records"))
                    p.str("collection")?.let { add("Collection" to it) }
                    p.str("recordId")?.let { add("Record ID" to it) }
                    if (p.str("action") != "delete_record") addAll(ApprovalArgs.fields(p.obj("data")))
                }
                "flighthub_booking" -> {
                    args?.str("itinerary")?.let { add("Itinerary" to it) }
                    add("Price" to listOfNotNull(args?.str("priceDisplay"), args?.str("currency") ?: "(currency unverified)").joinToString(" "))
                    args?.str("max_total")?.let { add("Budget ceiling" to listOfNotNull(it, args.str("currency")).joinToString(" ")) }
                }
            }
        }
        val needsExecutive = kind == "quickbooks_action" && (p["needsExecutiveApproval"] as? JsonPrimitive)?.contentOrNull == "true"
        val (section, note) = when (kind) {
            "google_workspace_action" -> "Review Google Workspace change" to null
            "calendar_action" -> "Review calendar change" to null
            "amazon_purchase" -> "Review Amazon cart handoff" to
                "Approval prepares a cart link. Nothing is ordered; you review the final price and complete checkout on Amazon."
            "quickbooks_action" -> quickBooksSection(p.str("actionName")).let { (heading, what) ->
                heading to if (needsExecutive) "$what Needs an Executive's approval: an Executive on this project, other than the person who asked, decides it." else what
            }
            "flighthub_booking" -> "Review FlightHub itinerary" to
                "Approval prepares a link. You verify the final itinerary, total and currency and complete the booking on FlightHub."
            "pipeline_run" -> "Review the pipeline run" to
                "Nothing runs until an org admin approves. Approving starts the run with these inputs."
            "app_record_action" -> (appNameOf(p) ?: "App") to when {
                p.str("action") == "delete_record" -> "This record will be permanently deleted from '${p.str("collection") ?: "records"}'."
                ApprovalArgs.fields(p.obj("data")).isEmpty() -> "No field values provided. Approving applies this change to the app's records."
                else -> "Approving applies this change to the app's records."
            }
            else -> null to null
        }

        return ApprovalView(
            id = rawId?.takeIf { it < UNPERSISTED_FLOOR }?.toInt(),
            unpersisted = rawId != null && rawId >= UNPERSISTED_FLOOR,
            kind = kind,
            title = title,
            reason = reason,
            requestedBy = p.str("requestedBy"),
            status = status,
            details = details,
            body = if (kind == "outbound_message") p.str("body") else null,
            input = input,
            section = section,
            note = note,
            channel = if (kind == "outbound_message") (if (p.str("channel") == "slack") "slack" else "email") else null,
            subject = if (kind == "outbound_message") p.str("subject") else null,
            to = if (kind == "outbound_message") p.list("to")?.split(", ").orEmpty() else emptyList(),
            actionName = p.str("actionName"),
            needsExecutive = needsExecutive,
            proposedBy = p.str("proposedBy"),
            calendarWorkflow = if (kind == "calendar_action") CalendarWorkflow.parse(p) else null,
            displayTitle = if (kind == "app_record_action") {
                "App action: ${appActionLabel(p.str("action")) ?: "action"} in ${p.str("collection") ?: appNameOf(p) ?: "App"}"
            } else null,
            noteWhilePending = kind == "pipeline_run" || (kind == "app_record_action" && p.str("action") != "delete_record"),
            pipelineName = p.str("pipelineName"),
            appName = appNameOf(p),
            collection = p.str("collection"),
            appAction = p.str("action"),
            recordId = p.str("recordId"),
            calendarId = p.obj("workflow")?.str("calendarId") ?: p.obj("args")?.str("calendar_id"),
        )
    }

    /** `app` is `{ id, slug, name }` on a proposal, a bare name on older ones. */
    private fun appNameOf(p: JsonObject): String? = p.obj("app")?.str("name") ?: p.str("app")

    /**
     * The chat line a decision posts into the room, word for word what the web
     * card sends, so the crew reacts to a phone decision as to a web one.
     * [assembly] is the decision response's scaffold outcome, when there was one.
     */
    fun decisionMessage(
        view: ApprovalView,
        approved: Boolean,
        assembly: JsonObject? = null,
        action: JsonObject? = null,
        outbound: JsonObject? = null,
    ): String {
        val recipients = view.to.joinToString(", ")
        if (view.isOutbound) {
            if (!approved) return "I discarded the ${view.channel} message draft to $recipients."
            return if (outbound?.str("sent") == "false") {
                "I approved sending the ${view.channel} message to $recipients, but delivery failed: ${outbound.str("error") ?: "unknown error"}."
            } else "I sent the ${view.channel} message to $recipients."
        }
        val id = view.id ?: return "I ${if (approved) "approved" else "rejected"} the proposal: \"${view.title}\"."
        if (!approved) return "I rejected proposal #$id (\"${view.title}\")."
        if (view.kind == "pipeline_run") {
            return if (action?.str("success") == "true") {
                "I approved running the pipeline \"${view.pipelineName}\". It has started; its result will be in the recent executions."
            } else "I approved running the pipeline \"${view.pipelineName}\", but it did not start: ${action?.str("error") ?: "no result received."}"
        }
        if (view.kind == "app_record_action") {
            return if (action?.str("success") == "true") {
                "I approved the app action (${appActionLabel(view.appAction) ?: "mutation"}) in \"${view.collection}\" of ${view.appName ?: "App"}."
            } else "I approved the app action, but it failed: ${action?.str("error") ?: "No result received."}"
        }
        if (view.kind in actionKinds) {
            val ok = action?.str("success") == "true"
            val error = action?.str("error") ?: "No execution result received."
            if (view.kind == "quickbooks_action") return quickBooksDecisionLine(view.actionName, ok, action, error)
            return when (view.kind) {
                "flighthub_booking" -> if (ok) "FlightHub handoff is ready. Open FlightHub to review and book manually; nothing has been purchased." else "FlightHub handoff failed: $error"
                "amazon_purchase" -> if (ok) "Amazon cart handoff prepared for ${view.title}. Nothing has been ordered; a human completes checkout." else "Amazon cart handoff failed: $error"
                "google_workspace_action" -> if (ok) "Google Workspace change applied: ${view.title}. Result: ${ApprovalArgs.format(action?.get("result"))}" else "Google Workspace change failed: $error"
                else -> if (ok) "Calendar change applied: ${view.title}. Result: ${ApprovalArgs.format(action?.get("result"))}" else "Calendar change failed: $error"
            }
        }
        if (assembly != null) {
            val success = (assembly["success"] as? JsonPrimitive)?.contentOrNull == "true"
            return if (!success) {
                "I approved proposal #$id (\"${view.title}\"), but the scaffold failed: ${assembly.str("error") ?: "unknown error"}."
            } else {
                val packs = (assembly["executedPacks"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
                "I approved proposal #$id (\"${view.title}\"). Scaffolded ${assembly.str("appName")} from ${packs.joinToString(", ")}."
            }
        }
        return "I approved proposal #$id (\"${view.title}\")."
    }

    /** The sensitivity an outbound message was classed as, in the web's words. */
    fun sensitivityLabel(raw: String): String = sensitivityLabels[raw] ?: raw.replace('_', ' ')

    /**
     * The checkout link an approved Amazon or FlightHub handoff returned, only
     * when it points at that retailer: the phone never opens an arbitrary URL
     * from a tool result.
     */
    fun handoffLink(view: ApprovalView, action: JsonObject?): Pair<String, String>? {
        if (action?.str("success") != "true") return null
        val url = action.obj("result")?.str("checkoutUrl") ?: return null
        return when {
            view.kind == "amazon_purchase" && Links.isAmazon(url) -> "Open cart on Amazon" to url
            view.kind == "flighthub_booking" && Links.isFlightHub(url) -> "Open FlightHub to book" to url
            else -> null
        }
    }

    /** What the persisted approval row says happened, for a card whose turn snapshot is stale. */
    fun readBack(row: JsonObject): ReadBack {
        val stored = row.obj("modifiedOutput") ?: row.obj("toolArgs")
        val outbound = stored?.takeIf { it.str("kind") == "outbound_message" }
        return ReadBack(
            status = row.str("status") ?: "pending",
            action = stored?.obj("outcome")?.takeIf { stored.str("kind") in outcomeKinds },
            sendResult = stored?.obj("sendResult"),
            body = outbound?.str("body"),
            subject = outbound?.str("subject"),
        )
    }

    /** A later message in the room that already decided this card, if any: the web's posted line. */
    fun decidedInRoom(view: ApprovalView, laterUserTurns: List<String>): String? {
        val id = view.id ?: return null
        return laterUserTurns.firstNotNullOfOrNull { text ->
            when {
                text.startsWith("I approved proposal #$id ") -> "approved"
                text.startsWith("I rejected proposal #$id ") -> "rejected"
                else -> null
            }
        }
    }
}

/** What POST /api/approvals/:id/decision said. */
/** An approval row's state as stored: its decision, a tool proposal's result, an outbound send's result, the draft after edits. */
data class ReadBack(
    val status: String,
    val action: JsonObject?,
    val sendResult: JsonObject?,
    val body: String?,
    val subject: String?,
)

sealed interface DecisionOutcome {
    /**
     * Recorded as asked. [assembly] is the scaffold result for an app
     * deployment, [action] a Google, Calendar, Amazon, FlightHub or QuickBooks
     * tool's result, a pipeline run's start or an app record change,
     * [outbound] an approved message's delivery result.
     */
    data class Recorded(
        val status: String,
        val assembly: JsonObject?,
        val action: JsonObject? = null,
        val outbound: JsonObject? = null,
    ) : DecisionOutcome
    /** Someone decided it first; [status] is what they chose. */
    data class AlreadyDecided(val status: String) : DecisionOutcome
    data class Failed(val message: String) : DecisionOutcome
}

/**
 * The route answers 200 both when it records the decision and when the request
 * was resolved before (`{ status, message: "...already been resolved." }`), so
 * the body says which.
 */
fun decisionOutcome(response: JsonObject, approved: Boolean): DecisionOutcome {
    val asked = if (approved) "approved" else "rejected"
    val message = response.str("message").orEmpty()
    val status = response.str("status")
    if (message.contains("already been resolved", ignoreCase = true)) return DecisionOutcome.AlreadyDecided(status ?: "decided")
    return DecisionOutcome.Recorded(
        asked,
        response.obj("assembly"),
        action = response.obj("googleWorkspaceAction") ?: response.obj("calendarAction")
            ?: response.obj("pipelineRun") ?: response.obj("appRecordAction"),
        outbound = response.obj("outboundMessage"),
    )
}

/** An API failure, in the words the web card uses. */
fun decisionFailure(e: Throwable): DecisionOutcome.Failed {
    val api = e as? ApiException
    return DecisionOutcome.Failed(
        when (api?.status) {
            403 -> "You are not the designated approver for this request."
            else -> "Could not record the decision: ${e.message ?: "unknown error"}"
        },
    )
}


// ---- QuickBooks proposals (InlineApprovalCard's quickbooks_action branch) ----

private fun quickBooksSection(actionName: String?): Pair<String, String> = when (actionName) {
    "quickbooks_create_customer" -> "Review QuickBooks customer" to "Approval creates the customer record in QuickBooks Online."
    "quickbooks_record_payment" -> "Review QuickBooks payment" to
        "Approval records the payment against the invoice. No money moves inside QuickBooks; the invoice balance is reduced."
    "quickbooks_void_invoice" -> "Review QuickBooks invoice void" to
        "Approval voids the invoice: amounts are zeroed, the record is kept for audit, and this cannot be undone."
    else -> "Review QuickBooks invoice" to
        "Approval creates an unpaid invoice. Taxes follow QuickBooks company settings. This does not email the invoice or collect payment."
}

private fun quickBooksDetails(p: JsonObject): List<Pair<String, String>> {
    val summary = p.obj("summary") ?: JsonObject(emptyMap())
    val args = p.obj("args") ?: JsonObject(emptyMap())
    val currency = summary.str("currency") ?: "currency unverified"
    fun money(key: String) = CrewMoney.format(summary.str(key), currency)
    return buildList {
        listOfNotNull(summary.str("company"), summary.str("customer")).takeIf { it.isNotEmpty() }?.let { add("For" to it.joinToString(" | ")) }
        when (p.str("actionName")) {
            "quickbooks_create_customer" -> {
                args.str("company_name")?.let { add("Company" to it) }
                args.str("email")?.let { add("Email" to it) }
                args.str("phone")?.let { add("Phone" to it) }
            }
            "quickbooks_record_payment" -> {
                add("Payment" to money("amount"))
                summary.str("invoice")?.let { add("Invoice" to "$it (balance ${money("balance")})") }
            }
            "quickbooks_void_invoice" -> {
                summary.str("invoice")?.let { add("Invoice" to it) }
                add("Total" to money("total"))
                add("Balance" to money("balance"))
            }
            else -> {
                add("Subtotal" to money("subtotal") + (summary.str("lineCount")?.let { " · $it line items" } ?: ""))
                args.str("txn_date")?.let { add("Invoice date" to it) }
                args.str("due_date")?.let { add("Due" to it) }
                (args["lines"] as? JsonArray)?.mapNotNull { it as? JsonObject }?.forEachIndexed { i, line ->
                    val label = line.str("description") ?: "Item ${line.str("item_id") ?: i + 1}"
                    add("Line ${i + 1}" to "$label: ${line.str("quantity") ?: "?"} × ${line.str("unit_price") ?: "?"}")
                }
            }
        }
    }
}

/** The room line a QuickBooks decision posts, word for word as the web card. */
private fun quickBooksDecisionLine(actionName: String?, ok: Boolean, action: JsonObject?, error: String): String {
    val result = action?.obj("result")
    val id = result?.str("Id").orEmpty()
    return if (ok) when (actionName) {
        "quickbooks_create_customer" -> "QuickBooks customer ${result?.str("DisplayName") ?: id} created."
        "quickbooks_record_payment" -> "QuickBooks payment $id recorded. The invoice balance was reduced."
        "quickbooks_void_invoice" -> "QuickBooks invoice ${result?.str("DocNumber") ?: id} voided."
        else -> "QuickBooks invoice ${result?.str("DocNumber") ?: id} created. It has not been emailed and no payment was collected."
    } else when (actionName) {
        "quickbooks_create_customer" -> "QuickBooks customer creation failed: $error"
        "quickbooks_record_payment" -> "QuickBooks payment failed: $error"
        "quickbooks_void_invoice" -> "QuickBooks invoice void failed: $error"
        else -> "QuickBooks invoice creation failed: $error"
    }
}
