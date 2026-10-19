package app.oddjob.crew.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.net.URI
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/*
 * Google Workspace, Microsoft 365, YouTube, Amazon and FlightHub results, as
 * the crew returns them in a `google_workspace_results` artifact. Mirrors
 * shared/crew-workspace-results.ts; only the fields the phone shows are read.
 */

@Serializable
data class WorkspaceItem(
    val id: String,
    /** email, calendar, document, video, product, flight, accounting or meeting (Granola). */
    val kind: String = "document",
    val platform: String? = null,
    val youtubeKind: String? = null,
    val thumbnailUrl: String? = null,
    /** A video's length in seconds. */
    val duration: Double? = null,
    val hasCaptions: Boolean? = null,
    val title: String = "",
    val preview: String? = null,
    val body: String? = null,
    val sender: String? = null,
    val recipient: String? = null,
    val attachments: List<String> = emptyList(),
    val date: String? = null,
    val start: String? = null,
    val end: String? = null,
    val timeZone: String? = null,
    val location: String? = null,
    val url: String? = null,
    val threadId: String? = null,
    val brand: String? = null,
    val asin: String? = null,
    val priceDisplay: String? = null,
    val listPriceDisplay: String? = null,
    val rating: Double? = null,
    val reviewCount: Long? = null,
    val isPrime: Boolean? = null,
    val availability: String? = null,
    val cartUrl: String? = null,
    val airlineName: String? = null,
    val flightNumbers: List<String> = emptyList(),
    val originCode: String? = null,
    val destinationCode: String? = null,
    val departAt: String? = null,
    val arriveAt: String? = null,
    val durationDisplay: String? = null,
    val stopsDisplay: String? = null,
    val cabinClass: String? = null,
    val viewCount: Long? = null,
    val subscriberCount: Long? = null,
    val videoCount: Long? = null,
    val itemCount: Long? = null,
    val customUrl: String? = null,
    // QuickBooks (platform "quickbooks", kind "accounting"): records, reports, and financial results.
    val currency: String? = null,
    val quickBooksEntity: String? = null,
    val quickBooksReport: String? = null,
    val reportStart: String? = null,
    val reportEnd: String? = null,
    /** Report columns QuickBooks typed as Money. */
    val moneyColumns: List<Int>? = null,
    val calculation: kotlinx.serialization.json.JsonObject? = null,
    val forecast: kotlinx.serialization.json.JsonObject? = null,
    val snapshot: kotlinx.serialization.json.JsonObject? = null,
    val snapshotComparison: kotlinx.serialization.json.JsonObject? = null,
)

@Serializable
data class WorkspaceResults(
    val title: String = "Results",
    val presentation: String = "cards",
    val items: List<WorkspaceItem> = emptyList(),
    val nextPageToken: String? = null,
    val nextSkipToken: String? = null,
    val nextOffset: Int? = null,
    val sourceTool: String = "",
    val sourceArgs: JsonObject = JsonObject(emptyMap()),
    val readCharacters: Int? = null,
    val complete: Boolean? = null,
)

/** Null for null or blank: the services send "" for an absent field as often as they omit it. */
internal fun String?.nonBlank(): String? = this?.takeIf { it.isNotBlank() }

/** An item chosen as chat context: the server re-reads it by these refs (POST /message `selectedContext`). */
data class WorkspaceSelection(val turnId: Int, val tool: String, val resultIndex: Int, val item: WorkspaceItem) {
    val itemId: String get() = item.id
    fun sameSlot(other: WorkspaceSelection) =
        turnId == other.turnId && tool == other.tool && resultIndex == other.resultIndex && itemId == other.itemId
}

/** What a Discuss / Draft reply / Summarize tap asks of the crew. */
enum class WorkspaceAction { DISCUSS, RESPOND, SUMMARIZE }

object Workspace {
    fun parse(payload: JsonObject): WorkspaceResults? =
        runCatching { CrewJson.decodeFromJsonElement(WorkspaceResults.serializer(), payload) }.getOrNull()
            ?.let { r -> r.copy(items = r.items.map(::normalize)) }

    /** Blank optional text is absent, so a card never draws an empty line for `location: ""`. */
    private fun normalize(i: WorkspaceItem) = i.copy(
        platform = i.platform.nonBlank(), youtubeKind = i.youtubeKind.nonBlank(), thumbnailUrl = i.thumbnailUrl.nonBlank(), preview = i.preview.nonBlank(),
        body = i.body.nonBlank(), sender = i.sender.nonBlank(), recipient = i.recipient.nonBlank(),
        attachments = i.attachments.filter { it.isNotBlank() }, date = i.date.nonBlank(), start = i.start.nonBlank(),
        end = i.end.nonBlank(), timeZone = i.timeZone.nonBlank(), location = i.location.nonBlank(), url = i.url.nonBlank(),
        threadId = i.threadId.nonBlank(), brand = i.brand.nonBlank(), asin = i.asin.nonBlank(),
        priceDisplay = i.priceDisplay.nonBlank(), listPriceDisplay = i.listPriceDisplay.nonBlank(),
        availability = i.availability.nonBlank(), cartUrl = i.cartUrl.nonBlank(), airlineName = i.airlineName.nonBlank(),
        originCode = i.originCode.nonBlank(), destinationCode = i.destinationCode.nonBlank(), departAt = i.departAt.nonBlank(),
        arriveAt = i.arriveAt.nonBlank(), durationDisplay = i.durationDisplay.nonBlank(), stopsDisplay = i.stopsDisplay.nonBlank(),
        cabinClass = i.cabinClass.nonBlank(), customUrl = i.customUrl.nonBlank(),
    )

    /** The composer text the web pre-fills for an action on selected items (AgentChatPanel's discussWorkspaceItems). */
    fun prompt(items: List<WorkspaceItem>, action: WorkspaceAction): String = when {
        action == WorkspaceAction.SUMMARIZE ->
            "Read the selected emails and provide a concise summary of each, highlighting requests, deadlines, and suggested next steps. Do not send or modify anything."
        action == WorkspaceAction.DISCUSS -> "Discuss the selected items."
        items.all { it.kind == "email" } -> "Read the selected emails and draft replies for my review. Do not send them."
        items.all { it.kind == "flight" } ->
            "Book the selected flight on FlightHub. Call flighthub_propose_booking with the session_id (sessionRef) and offer_ref (offerRef) carried in the selected item context, summarizing the itinerary on the proposal card. Stop for me at the payment step."
        else -> "Review the selected items and prepare any suggested responses or changes for my approval."
    }

    /** The per-item "respond" button label, as the web words it. */
    fun respondLabel(item: WorkspaceItem): String = when {
        item.kind == "email" || item.youtubeKind == "comment" -> "Draft reply"
        item.kind == "calendar" -> "Respond / plan"
        item.youtubeKind == "channel" -> "Plan channel content"
        item.youtubeKind == "playlist" -> "Plan playlist"
        item.kind == "video" -> "Plan content"
        item.kind == "product" -> "Plan purchase"
        item.kind == "flight" -> "Review booking"
        item.quickBooksReport != null -> "Analyze variance"
        item.kind == "accounting" -> "Review next steps"
        else -> "Review / edit"
    }

    /** The message "Load more" posts, or null when the source has no further page. */
    fun moreMessage(results: WorkspaceResults): String? {
        val (key, value) = when {
            results.nextPageToken != null -> "page_token" to JsonPrimitive(results.nextPageToken)
            results.nextSkipToken != null -> "skip_token" to JsonPrimitive(results.nextSkipToken)
            results.nextOffset != null -> "offset" to JsonPrimitive(results.nextOffset)
            else -> return null
        }
        val args = JsonObject(results.sourceArgs + (key to value))
        return "Continue the result from ${results.sourceTool} with these query parameters: $args. Display the next results."
    }

    /**
     * Where an item opens, and as what. Only hosts the web card also opens are
     * accepted, so an agent-written URL cannot send the phone somewhere else.
     */
    fun openLink(item: WorkspaceItem): Pair<String, String>? {
        if (item.kind == "email") {
            val id = item.threadId ?: item.id
            if (Regex("^[a-zA-Z0-9_-]+$").matches(id)) return "Open in Gmail" to "https://mail.google.com/mail/u/0/#all/$id"
        }
        val url = item.url ?: return null
        return when {
            item.platform == "flighthub" && Links.isFlightHub(url) -> "Open on FlightHub" to url
            item.platform == "youtube" && Regex("^https://www\\.youtube\\.com/(?:watch\\?|channel/|playlist\\?)").containsMatchIn(url) -> "Open in YouTube" to url
            item.platform == "amazon" && Links.isAmazon(url) -> "Open on Amazon" to url
            Regex("^https://(?:(docs\\.google\\.com|drive\\.google\\.com|calendar\\.google\\.com)/|www\\.google\\.com/calendar/)").containsMatchIn(url) -> "Open in Google" to url
            item.platform == "microsoft365" &&
                Regex("^https://(?:[a-z0-9-]+\\.sharepoint\\.com|onedrive\\.live\\.com|[a-z0-9.-]+\\.office\\.com|m365\\.cloud\\.microsoft)/", RegexOption.IGNORE_CASE).containsMatchIn(url) ->
                "Open in Microsoft 365" to url
            item.platform == "granola" && Regex("^https://(?:notes\\.)?granola\\.ai/", RegexOption.IGNORE_CASE).containsMatchIn(url) -> "Open in Granola" to url
            else -> null
        }
    }

    /**
     * A calendar time as the web shows it (WorkspaceResultCard's displayTime):
     * a date-only value is an all-day day; a timestamp is shown in the event's
     * zone, with the zone named. Anything unparseable is shown as-is.
     */
    fun displayTime(value: String, zone: String? = null, withZone: Boolean = true, locale: Locale = Locale.getDefault()): String {
        if (Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(value)) {
            val day = runCatching { LocalDate.parse(value).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)) }.getOrDefault(value)
            return "$day · All day"
        }
        // ISO from Calendar and Drive; RFC 2822 from Gmail's Date header ("Wed, 24 Jun 2026 18:34:02 +0000 (UTC)").
        val instant = runCatching { OffsetDateTime.parse(value).toInstant() }.getOrNull()
            ?: runCatching {
                OffsetDateTime.parse(value.replace(Regex("\\s*\\([^)]*\\)\\s*$"), "").trim(), DateTimeFormatter.RFC_1123_DATE_TIME).toInstant()
            }.getOrNull()
            ?: return value
        val zoneId = zone?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()
        val text = instant.atZone(zoneId).format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale))
        return if (withZone && zone != null) "$text · $zone" else text
    }

    /** The when-line of a calendar or dated item: start (or date) → end, the end carrying the zone. */
    fun whenLine(item: WorkspaceItem, locale: Locale = Locale.getDefault()): String? {
        val start = item.start.nonBlank() ?: item.date.nonBlank() ?: return null
        val end = item.end.nonBlank()
        val first = displayTime(start, item.timeZone, withZone = end == null, locale = locale)
        if (end == null) return first
        val exclusive = if (end.length == 10) " (exclusive end)" else ""
        return "$first → ${displayTime(end, item.timeZone, locale = locale)}$exclusive"
    }

    /** The card's text for the clipboard (crew-card-copy.ts). */
    fun copyText(results: WorkspaceResults): String = (listOf(results.title) + results.items.map { item ->
        listOfNotNull(
            item.title,
            item.brand?.let { "Brand: $it" },
            item.airlineName?.takeIf { item.kind == "flight" }?.let { "Airline: $it" },
            item.departAt?.takeIf { item.kind == "flight" }?.let { "Departs: $it" },
            item.arriveAt?.takeIf { item.kind == "flight" }?.let { "Arrives: $it" },
            item.durationDisplay?.takeIf { item.kind == "flight" }?.let { "Duration: $it" },
            item.stopsDisplay?.takeIf { item.kind == "flight" }?.let { "Stops: $it" },
            item.priceDisplay?.let { "Price: $it" },
            item.listPriceDisplay?.takeIf { it != item.priceDisplay }?.let { "List price: $it" },
            item.rating?.let { "Rating: $it (${item.reviewCount ?: 0} reviews)" },
            item.availability?.let { "Availability: $it" },
            "Prime eligible".takeIf { item.isPrime == true },
            item.sender?.let { "From: $it" },
            item.recipient?.let { "To: $it" },
            item.start?.let { "Starts: $it" } ?: item.date,
            item.end?.let { "Ends: $it" },
            item.location,
            item.body ?: item.preview,
            item.url,
        ).filter { it.isNotBlank() }.joinToString("\n")
    }).joinToString("\n\n")
}

/** Retailer and travel links the phone will open; mirrors shared/amazon-links.ts and flighthub-links.ts. */
object Links {
    private val amazonHost = Regex(
        "^(?:www\\.)?amazon\\.(?:com|ca|com\\.mx|com\\.br|co\\.uk|de|fr|it|es|nl|se|pl|com\\.be|ie|co\\.jp|in|com\\.au|sg|ae|sa|com\\.tr|eg)$",
        RegexOption.IGNORE_CASE,
    )

    private fun plainHttps(value: String): URI? = runCatching { URI(value) }.getOrNull()
        ?.takeIf { it.scheme == "https" && it.userInfo == null && it.port == -1 && it.host != null }

    fun isAmazon(value: String?): Boolean = value != null && plainHttps(value)?.host?.let(amazonHost::matches) == true

    private val youtubeImage = Regex("^https://(?:i\\.ytimg\\.com|i[0-9]\\.ytimg\\.com|yt[0-9]\\.ggpht\\.com)/")
    private val amazonImage = Regex("^https://(?:[\\w-]+\\.)*media-amazon\\.com/")

    /**
     * The item's thumbnail, only from the image hosts the web card accepts
     * (WorkspaceResultCard's YT_THUMBNAIL and AMZ_IMAGE), so a tool result cannot
     * make the phone fetch an arbitrary URL.
     */
    fun thumbnail(item: WorkspaceItem): String? {
        val url = item.thumbnailUrl ?: return null
        return when (item.platform) {
            "youtube" -> url.takeIf { youtubeImage.containsMatchIn(it) }
            "amazon" -> url.takeIf { amazonImage.containsMatchIn(it) }
            else -> null
        }
    }

    fun isFlightHub(value: String?): Boolean =
        value != null && plainHttps(value)?.host?.let { it == "flighthub.com" || it == "www.flighthub.com" } == true
}

/**
 * A user turn that carried selected items: the agents read the JSON block the
 * server appended; people see the message and a chip per item.
 */
data class WorkspaceContext(val message: String, val labels: List<String>, val kinds: List<String>)

object CrewText {
    private const val CONTEXT_MARKER = "\n\n[CREW selected Google items]\n"

    fun splitWorkspaceContext(content: String): WorkspaceContext {
        val index = content.indexOf(CONTEXT_MARKER)
        if (index < 0) return WorkspaceContext(content, emptyList(), emptyList())
        val json = content.substring(index + CONTEXT_MARKER.length).substringBefore('\n')
        val items = runCatching { CrewJson.parseToJsonElement(json) as? JsonArray }.getOrNull()
            ?: return WorkspaceContext(content, emptyList(), emptyList())
        val objects = items.mapNotNull { it as? JsonObject }
        fun JsonObject.str(k: String) = (this[k] as? JsonPrimitive)?.contentOrNull
        return WorkspaceContext(
            message = content.substring(0, index),
            labels = objects.map { it.str("title") ?: "Selected item" },
            kinds = objects.map { it.str("kind") ?: "document" },
        )
    }

    data class ProviderError(val title: String, val message: String, val nextStep: String)

    /** A supervisor turn reporting a model-provider failure, in words a person can act on (shared/crew-provider-error.ts). */
    fun providerError(content: String): ProviderError? {
        fun has(pattern: String) = Regex(pattern, RegexOption.IGNORE_CASE).containsMatchIn(content)
        if (!has("(?:API error|model provider|configured model account|response could not be generated)")) return null
        if (has("credit balance.*too low|insufficient.*(?:credit|balance)|billing.*(?:limit|exhaust)|payment required")) {
            return ProviderError(
                "Model account needs credit",
                "The response could not be generated because the configured model account has insufficient credit.",
                "Add credit to the provider account or choose another connected model in the agent settings.",
            )
        }
        if (has("API error[^\\n]*\\{|\"type\"\\s*:\\s*\"error\"")) {
            return ProviderError(
                "Model request failed",
                "The model provider rejected this request. No completed answer is available.",
                "Check the connected model settings and retry. Technical details are retained in the server logs.",
            )
        }
        if (has("quota was exhausted")) {
            return ProviderError("Model usage limit reached", "The connected model has reached its usage limit.", "Check the provider quota or choose another connected model, then retry.")
        }
        if (has("rejected its credentials")) {
            return ProviderError("Model connection needs attention", "The provider could not authenticate the configured model account.", "Update the model credentials in your organization settings, then retry.")
        }
        if (has("provider was unreachable")) {
            return ProviderError("Model temporarily unavailable", "CREW could not reach the connected model provider.", "Retry shortly or choose another connected model.")
        }
        return null
    }
}
