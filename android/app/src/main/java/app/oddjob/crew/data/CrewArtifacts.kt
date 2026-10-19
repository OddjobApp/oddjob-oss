package app.oddjob.crew.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull

/*
 * The structured turn artifacts the phone renders natively beyond forms and
 * approvals. Each parser returns null for a payload that does not hold its
 * shape, so a malformed artifact falls back to the "not shown" line instead of
 * a half-drawn card.
 */

private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
private fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull
private fun JsonObject.num(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull
private fun JsonObject.strings(key: String): List<String> =
    (this[key] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.takeIf(String::isNotBlank) }.orEmpty()
private fun JsonObject.objects(key: String): List<JsonObject> = (this[key] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()

// ---- Performance scorecards and phase-gate reviews (shared/crew-review.ts) ----

data class ReviewCriterion(val label: String, val score: Double?, val weight: Double, val evidence: String)
data class ReviewGate(val label: String, val status: String, val evidence: String)
data class ReviewAction(val description: String, val owner: String?, val due: String?)

data class CrewReview(
    val title: String,
    val summary: String,
    val period: String,
    val methodologyVersion: String,
    val criteria: List<ReviewCriterion>,
    val gates: List<ReviewGate>,
    val actions: List<ReviewAction>,
) {
    /** Weighted mean, published only when every dimension is assessed: missing evidence is never a zero. */
    val score: Double? get() =
        if (criteria.any { it.score == null }) null
        else criteria.sumOf { it.score!! * it.weight } / criteria.sumOf { it.weight }

    val assessed: Int get() = criteria.count { it.score != null }

    val status: String get() = when {
        gates.any { it.status == "fail" } -> "Blocked"
        criteria.any { it.score == null } || gates.any { it.status == "unknown" } -> "Needs evidence"
        else -> "Ready for review"
    }

    companion object {
        /** Null when the payload breaks the schema the web validates against. */
        fun parse(p: JsonObject): CrewReview? {
            if (p.str("type") !in setOf("performance_scorecard", "gate_review")) return null
            val criteria = p.objects("criteria").map { c ->
                val score = c.num("score")
                val weight = c.num("weight") ?: return null
                if (score != null && score !in 0.0..100.0 || weight <= 0) return null
                ReviewCriterion(c.str("label") ?: return null, score, weight, c.str("evidence") ?: return null)
            }
            if (criteria.isEmpty()) return null
            val gates = p.objects("gates").map { g ->
                val status = g.str("status")?.takeIf { it in setOf("pass", "fail", "unknown") } ?: return null
                ReviewGate(g.str("label") ?: return null, status, g.str("evidence") ?: return null)
            }
            val actions = p.objects("actions").map { a -> ReviewAction(a.str("description") ?: return null, a.str("owner"), a.str("due")) }
            return CrewReview(
                title = p.str("title") ?: return null,
                summary = p.str("summary") ?: return null,
                period = p.str("period") ?: return null,
                methodologyVersion = p.str("methodologyVersion") ?: return null,
                criteria = criteria,
                gates = gates,
                actions = actions,
            )
        }
    }
}

// ---- Room brief and work products ----

@Serializable
data class RoomBrief(
    val objective: String,
    val successCriteria: List<String> = emptyList(),
    val constraints: List<String> = emptyList(),
) {
    companion object {
        /** The brief from editor text, or why it cannot be saved (the server's crewRoomBriefSchema limits). */
        fun fromInput(objective: String, criteria: String, constraints: String): Result<RoomBrief> {
            fun lines(v: String) = v.split('\n').map(String::trim).filter(String::isNotEmpty)
            val brief = RoomBrief(objective.trim(), lines(criteria), lines(constraints))
            val ok = brief.objective.isNotEmpty() && brief.objective.length <= 2000 &&
                brief.successCriteria.size in 1..20 && brief.successCriteria.all { it.length <= 500 } &&
                brief.constraints.size <= 20 && brief.constraints.all { it.length <= 500 }
            return if (ok) Result.success(brief)
            else Result.failure(IllegalArgumentException("Enter an objective and at least one success criterion. Keep the objective under 2,000 characters and each criterion under 500."))
        }
    }
}

@Serializable
data class WorkProductTurn(val id: Int, val speakerName: String = "", val artifacts: List<TurnArtifact> = emptyList())

/** One saved version of a room deliverable. */
data class WorkProduct(
    val documentKey: String,
    val title: String,
    val content: String,
    val changeSummary: String,
    val sourceTurnId: Int?,
    val turnId: Int,
    val author: String,
) {
    val versionKey: String get() = "$turnId-$documentKey"

    companion object {
        fun parse(p: JsonObject?, turnId: Int, author: String): WorkProduct? {
            if (p == null || p.str("type") != "crew_work_product") return null
            return WorkProduct(
                documentKey = p.str("documentKey") ?: return null,
                title = p.str("title") ?: return null,
                content = p.str("content") ?: return null,
                changeSummary = p.str("changeSummary") ?: return null,
                sourceTurnId = p.int("sourceTurnId"),
                turnId = turnId,
                author = author,
            )
        }

        /**
         * Every version, oldest first. The room read carries the last 100
         * work-product turns separately because a long room's transcript
         * window may not reach back to them; a loaded turn wins over its copy.
         */
        fun collect(turns: List<CrewTurn>, workProductTurns: List<WorkProductTurn>): List<WorkProduct> {
            val loaded = turns.map { it.id }.toSet()
            val sources = workProductTurns.filter { it.id !in loaded }.map { Triple(it.id, it.speakerName, it.artifacts) } +
                turns.map { Triple(it.id, it.speakerName, it.artifacts) }
            return sources.sortedBy { it.first }.flatMap { (id, author, artifacts) ->
                artifacts.mapNotNull { parse(it.payload, id, author) }
            }
        }
    }
}

// ---- Decisions, claims and commitments proposed in a turn ----

/** Which durable record a turn card is about, and the record's id when it was persisted. */
data class RecordCard(
    /** "decisions", "claims" or "commitments": the PATCH route segment. */
    val kind: String,
    val id: Int?,
    val text: String,
    val detail: String?,
    val status: String,
    val confidence: Int?,
    val createdBy: String?,
    val extra: List<Pair<String, String>>,
) {
    /** Status changes offered on the card. Only values the server accepts (CrewEnums), unlike the web card's. */
    val actions: List<Pair<String, String>> get() = when (kind) {
        "decisions" -> if (status == "proposed") listOf("accepted" to "Ratify", "rejected" to "Reject") else emptyList()
        "claims" -> if (status == "unverified" || status == "disputed") listOf("supported" to "Supported", "disputed" to "Disputed", "refuted" to "Refuted").filter { it.first != status } else emptyList()
        "commitments" -> when (status) {
            "open", "blocked" -> listOf("in_progress" to "Start", "completed" to "Complete", "cancelled" to "Cancel")
            "in_progress" -> listOf("completed" to "Complete", "blocked" to "Blocked")
            else -> emptyList()
        }
        else -> emptyList()
    }

    /** The line posted to the room so the crew learns of the change. */
    fun changeMessage(status: String): String = when (kind) {
        "decisions" -> if (status == "accepted") "I ratified the decision: \"$text\"" else "I rejected the decision proposal: \"$text\""
        "claims" -> "I marked the claim as $status: \"$text\""
        else -> {
            val verb = when (status) {
                "completed" -> "completed"
                "in_progress" -> "started working on"
                "blocked" -> "marked as blocked"
                else -> "cancelled"
            }
            "I $verb the commitment: \"$text\""
        }
    }

    companion object {
        private val decisionTools = setOf("ratify_decision", "propose_crew_decision")
        private val claimTools = setOf("verify_claim", "propose_crew_claim")
        private val commitmentTools = setOf("record_commitment", "propose_crew_commitment")

        fun parse(tool: String, p: JsonObject): RecordCard? {
            val type = p.str("type")
            val kind = p.str("kind")
            return when {
                type in setOf("decision_ratification", "crew_decision") || kind == "crew_decision" || tool in decisionTools -> RecordCard(
                    kind = "decisions",
                    id = p.int("decisionId") ?: p.int("id"),
                    text = p.str("statement") ?: p.str("title") ?: p.str("proposalTitle") ?: return null,
                    detail = p.str("rationale"),
                    status = p.str("status") ?: "proposed",
                    confidence = p.int("confidence"),
                    createdBy = p.str("createdBy"),
                    extra = listOfNotNull(p.strings("alternatives").takeIf { it.isNotEmpty() }?.let { "Alternatives" to it.joinToString(" · ") }),
                )
                type in setOf("claim_verification", "crew_claim") || kind == "crew_claim" || tool in claimTools -> RecordCard(
                    kind = "claims",
                    id = p.int("claimId") ?: p.int("id"),
                    text = p.str("claim") ?: p.str("statement") ?: return null,
                    detail = null,
                    status = p.str("status") ?: "unverified",
                    confidence = p.int("confidence"),
                    createdBy = p.str("createdBy"),
                    extra = listOfNotNull(p.int("agreementLevel")?.let { "Agreement" to "$it%" }) +
                        p.objects("evidence").mapNotNull { e -> e.str("label")?.let { "Evidence" to listOfNotNull(it, e.str("uri")).joinToString(" · ") } } +
                        p.objects("positions").mapNotNull { pos ->
                            val name = pos.str("agentName") ?: return@mapNotNull null
                            name to listOfNotNull(pos.str("position"), pos.str("rationale")).joinToString(": ")
                        },
                )
                type in setOf("commitment_contract", "crew_commitment") || kind == "crew_commitment" || tool in commitmentTools -> RecordCard(
                    kind = "commitments",
                    id = p.int("commitmentId") ?: p.int("id"),
                    text = p.str("title") ?: p.str("statement") ?: return null,
                    detail = p.str("detail"),
                    status = p.str("status") ?: "open",
                    confidence = null,
                    createdBy = p.str("createdBy"),
                    extra = listOfNotNull(p.str("ownerId")?.let { "Owner" to it }, p.str("dueAt")?.let { "Due" to it }) +
                        p.objects("completionEvidence").mapNotNull { e -> e.str("label")?.let { "Evidence" to it } },
                )
                else -> null
            }
        }
    }
}

/**
 * A governance checkpoint the crew raised. Shown read-only: the web card's
 * buttons only post a chat line and record no approval, so the phone does not
 * offer a control that looks like it authorizes anything.
 */
data class GovernanceCheckpoint(
    val actionTitle: String,
    val riskTier: String?,
    val requestedBy: String?,
    val status: String,
    val summary: String?,
    val facts: List<Pair<String, String>>,
) {
    companion object {
        fun parse(tool: String, payload: JsonObject): GovernanceCheckpoint? {
            val type = payload.str("type")
            if (type !in setOf("governance_blast_radius", "governance_checkpoint", "crew_governance_gate_pod") && tool != "request_governance_approval") return null
            val p = payload["checkpoint"] as? JsonObject ?: payload
            val blast = p["blastRadius"] as? JsonObject ?: JsonObject(emptyMap())
            return GovernanceCheckpoint(
                actionTitle = p.str("actionTitle") ?: p.str("title") ?: return null,
                riskTier = p.str("riskTier"),
                requestedBy = p.str("requestedBy"),
                status = p.str("status") ?: "pending",
                summary = blast.str("summary"),
                facts = listOfNotNull(
                    blast.strings("affectedServices").takeIf { it.isNotEmpty() }?.let { "Affected services" to it.joinToString(", ") },
                    (blast["dataDestructionRisk"] as? JsonPrimitive)?.contentOrNull?.takeIf { it == "true" }?.let { "Data destruction" to "Possible" },
                    blast.num("estimatedCostUsd")?.let { "Estimated cost" to "$" + "%,.2f".format(it) },
                    blast.int("tenantsImpactedCount")?.let { "Tenants impacted" to it.toString() },
                    (p["requiresDualSignOff"] as? JsonPrimitive)?.contentOrNull?.takeIf { it == "true" }?.let { "Sign-off" to "Two approvers required" },
                ),
            )
        }
    }
}

// ---- Gmail sender alerts ----

data class GmailDirective(
    val sender: String,
    val status: String,
    val mailbox: String?,
    val intervalSeconds: Int?,
    val lastCheckedAt: String?,
    val error: String?,
    val browserPushReady: Boolean,
) {
    val statusLabel: String get() = status.replace('_', ' ')

    companion object {
        fun parse(p: JsonObject): GmailDirective? {
            val sender = p.str("sender") ?: return null
            return GmailDirective(
                sender = sender,
                status = p.str("status") ?: "active",
                mailbox = p.str("mailbox"),
                intervalSeconds = p.int("intervalSeconds"),
                lastCheckedAt = p.str("lastCheckedAt"),
                error = p.str("error"),
                browserPushReady = (p["browserPushReady"] as? JsonPrimitive)?.contentOrNull == "true",
            )
        }

        fun list(p: JsonObject): List<GmailDirective> = p.objects("items").mapNotNull(::parse)

        /** The chat commands the card's buttons send; the server handles `/directive` without a round. */
        fun toggleCommand(d: GmailDirective) = "/directive ${if (d.status == "paused") "resume" else "pause"} ${d.sender}"
        fun removeCommand(d: GmailDirective) = "/directive remove ${d.sender}"
        fun statusCommand(d: GmailDirective) = "/directive status ${d.sender}"
    }
}

// ---- Maps (MapSurface.tsx) ----

data class MapPlace(val lat: Double, val lng: Double, val label: String?, val description: String?)

data class MapCardData(
    val title: String,
    val description: String?,
    val markers: List<MapPlace>,
    /** [lng, lat] pairs of a route's path; empty when there is none. */
    val routePoints: List<Pair<Double, Double>>,
    val waypoints: List<MapPlace>,
    /** True when the path came from a routing provider; false is a straight dashed line between stops. */
    val routeSnapped: Boolean,
    val distanceKm: Double?,
    val durationMin: Double?,
    val center: Pair<Double, Double>?,
    val zoom: Double?,
    /** "dark", "satellite" or "streets". */
    val style: String,
) {
    /** Nothing to plot: the web then offers the viewer's own location. */
    val empty: Boolean get() = markers.isEmpty() && routePoints.size < 2 && waypoints.isEmpty()

    /** Where the camera starts: the payload's center, else the mean of what is plotted, as the web computes it. */
    val focus: Pair<Double, Double>? get() = center
        ?: markers.takeIf { it.isNotEmpty() }?.let { m -> m.sumOf { it.lat } / m.size to m.sumOf { it.lng } / m.size }
        ?: routePoints.takeIf { it.isNotEmpty() }?.let { r -> r.sumOf { it.second } / r.size to r.sumOf { it.first } / r.size }

    /** The web's zoom: the payload's, else from the route's span, else a street level for one place and a city for several. */
    val cameraZoom: Double get() {
        zoom?.let { return it }
        if (routePoints.size >= 2) {
            val span = maxOf(
                routePoints.maxOf { it.first } - routePoints.minOf { it.first },
                routePoints.maxOf { it.second } - routePoints.minOf { it.second },
            )
            return when {
                span > 20 -> 4.0; span > 10 -> 5.0; span > 5 -> 6.0; span > 2 -> 7.0; span > 1 -> 8.0; span > 0.5 -> 9.0; span > 0.2 -> 10.0
                else -> 11.0
            }
        }
        return if (markers.size > 1) 11.0 else 13.0
    }

    companion object {
        private fun place(o: JsonObject): MapPlace? {
            val lat = o.num("lat") ?: return null
            val lng = o.num("lng") ?: return null
            if (lat !in -90.0..90.0 || lng !in -180.0..180.0) return null
            return MapPlace(lat, lng, o.str("label"), o.str("description"))
        }

        fun parse(p: JsonObject): MapCardData? {
            if (p.str("type") !in setOf("assistant_map", "map")) return null
            val markers = p.objects("markers").mapNotNull(::place).ifEmpty {
                // A single place sent flat, as the web also accepts.
                listOfNotNull(place(p)?.copy(label = p.str("label") ?: p.str("title") ?: "Location", description = p.str("description")))
            }
            val route = p["route"] as? JsonObject
            val points = (route?.get("points") as? JsonArray)?.mapNotNull { pair ->
                val xy = (pair as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.doubleOrNull }
                if (xy != null && xy.size == 2 && xy[1] in -90.0..90.0 && xy[0] in -180.0..180.0) xy[0] to xy[1] else null
            }.orEmpty()
            val waypoints = route?.objects("waypoints")?.mapNotNull(::place).orEmpty()
            val center = (p["center"] as? JsonObject)?.let { c -> c.num("lat")?.let { lat -> c.num("lng")?.let { lng -> lat to lng } } }
            return MapCardData(
                title = p.str("title") ?: "Geographic Map",
                description = p.str("description"),
                markers = markers,
                routePoints = points.ifEmpty { if (waypoints.size >= 2) waypoints.map { it.lng to it.lat } else emptyList() },
                waypoints = waypoints,
                routeSnapped = (route?.get("snapped") as? JsonPrimitive)?.contentOrNull == "true",
                distanceKm = route?.num("distanceKm"),
                durationMin = route?.num("durationMin"),
                center = center,
                zoom = p.num("zoom"),
                style = p.str("mapStyle")?.takeIf { it in setOf("dark", "satellite", "streets") } ?: "dark",
            )
        }
    }
}

// ---- Files the person uploaded (room_attachments) ----

data class RoomFile(
    val id: Int,
    val name: String,
    val mimeType: String?,
    val byteSize: Long,
    val isImage: Boolean,
    val parseStatus: String,
    val preview: String?,
)

data class RoomFiles(val sessionKey: String, val items: List<RoomFile>) {
    fun thumbnailPath(file: RoomFile, width: Int) = "/api/crew/${java.net.URLEncoder.encode(sessionKey, "UTF-8")}/attachments/${file.id}/thumbnail?w=$width"

    companion object {
        fun parse(p: JsonObject): RoomFiles? {
            if (p.str("type") != "room_attachments") return null
            val key = p.str("sessionKey") ?: return null
            val items = p.objects("items").mapNotNull { o ->
                val id = o.int("id") ?: return@mapNotNull null
                RoomFile(
                    id = id,
                    name = o.str("name") ?: "file",
                    mimeType = o.str("mimeType"),
                    byteSize = (o["byteSize"] as? JsonPrimitive)?.contentOrNull?.toLongOrNull() ?: 0,
                    isImage = o.str("kind") == "image",
                    parseStatus = o.str("parseStatus") ?: "pending",
                    preview = o.str("preview"),
                )
            }
            return if (items.isEmpty()) null else RoomFiles(key, items)
        }
    }
}

// ---- Carousels ----

data class CarouselItem(
    val title: String,
    val subtitle: String?,
    val description: String?,
    val badge: String?,
    val meta: List<Pair<String, String>>,
    val tags: List<String>,
    val ctaLabel: String?,
    val ctaHref: String?,
)

data class Carousel(val title: String?, val description: String?, val items: List<CarouselItem>) {
    companion object {
        fun parse(p: JsonObject): Carousel? {
            if (p.str("type") != "assistant_carousel") return null
            val items = p.objects("items").map { item ->
                CarouselItem(
                    title = item.str("title").orEmpty(),
                    subtitle = item.str("subtitle"),
                    description = item.str("description"),
                    badge = item.str("badge"),
                    meta = item.objects("meta").take(4).mapNotNull { m -> m.str("label")?.let { it to m.str("value").orEmpty() } },
                    tags = item.strings("tags").take(4),
                    ctaLabel = item.str("ctaLabel"),
                    ctaHref = item.str("ctaHref"),
                )
            }
            return if (items.isEmpty()) null else Carousel(p.str("title"), p.str("description"), items)
        }
    }
}
