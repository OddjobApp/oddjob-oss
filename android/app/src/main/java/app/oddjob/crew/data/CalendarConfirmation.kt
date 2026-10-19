package app.oddjob.crew.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * The event an approved calendar change created, as the web's confirmation
 * shows it (CalendarApprovalView): times in the viewer's own zone, the
 * calendar it went into, and a link only when it points at Google Calendar.
 */
data class CalendarConfirmation(
    val summary: String?,
    val calendar: String?,
    val start: String?,
    val end: String?,
    /** The viewer's zone, named when the times are timed rather than all-day. */
    val zone: String?,
    val location: String?,
    val link: String?,
) {
    /** Labelled lines under the summary, in the web's order. */
    fun lines(): List<Pair<String, String>> = listOfNotNull(
        calendar?.let { "Calendar" to it },
        start?.let { "Starts" to it },
        end?.let { "Ends" to it },
        zone?.let { "Your time zone" to it },
        location?.let { "Location" to it },
    )

    companion object {
        private val eventLink = Regex("^https://(?:calendar\\.google\\.com|www\\.google\\.com)/")

        private fun JsonObject.str(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
        private fun JsonObject.obj(key: String) = this[key] as? JsonObject

        /** [result] is the Google event resource; [fallbackCalendar] the calendar the proposal named. */
        fun parse(
            result: JsonObject,
            fallbackCalendar: String?,
            zone: ZoneId = ZoneId.systemDefault(),
            locale: Locale = Locale.getDefault(),
        ): CalendarConfirmation {
            val start = result.obj("start")
            val end = result.obj("end")
            return CalendarConfirmation(
                summary = result.str("summary"),
                calendar = result.obj("organizer")?.str("email") ?: fallbackCalendar,
                start = start?.let { time(it, zone, locale) },
                end = end?.let { time(it, zone, locale) },
                zone = zone.id.takeIf { start?.str("dateTime") != null },
                location = result.str("location"),
                link = result.str("htmlLink")?.takeIf { eventLink.containsMatchIn(it) },
            )
        }

        /** calendarTime: a timed value in the viewer's zone; an all-day value as its date. */
        internal fun time(value: JsonObject, zone: ZoneId, locale: Locale): String? {
            val dateTime = value.str("dateTime") ?: return value.str("date")
            val instant = runCatching { java.time.OffsetDateTime.parse(dateTime).toInstant() }.getOrNull()
                ?: runCatching { Instant.parse(dateTime) }.getOrNull()
                ?: return dateTime
            return instant.atZone(zone).format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale))
        }

        /** What a "Verify in Google" check found, in the web's words. */
        fun verificationLine(
            outcome: Result<JsonObject?>,
            zone: ZoneId = ZoneId.systemDefault(),
            locale: Locale = Locale.getDefault(),
        ): String {
            val body = outcome.getOrNull()
                ?: return "Could not verify this event. Check Calendar access and the destination account before creating another event."
            if ((body["found"] as? JsonPrimitive)?.contentOrNull != "true") {
                return "Google reports this event was cancelled. No new event was created."
            }
            val at = body.str("verifiedAt")?.let { runCatching { Instant.parse(it) }.getOrNull() }
                ?.atZone(zone)?.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.MEDIUM).withLocale(locale))
            return "Verified in Google${at?.let { " at $it" } ?: ""}. If the link fails, open the destination calendar and search for this title."
        }
    }
}
