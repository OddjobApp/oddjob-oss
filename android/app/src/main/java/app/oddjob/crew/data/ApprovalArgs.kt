package app.oddjob.crew.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * A proposal's tool arguments as labelled, readable fields: a port of
 * shared/approval-args.ts, so a reviewer on the phone sees what the web shows
 * and never the raw routing envelope.
 */
object ApprovalArgs {
    fun humanize(key: String): String {
        val words = key.replace(Regex("([a-z0-9])([A-Z])"), "$1 $2").replace('_', ' ').lowercase()
        return words.replaceFirstChar(Char::uppercase)
    }

    /** Any value into text; past two levels a compact literal is more honest than pseudo-prose. */
    fun format(value: JsonElement?, depth: Int = 0): String = when (value) {
        null, JsonNull -> ""
        is JsonPrimitive -> value.contentOrNull.orEmpty()
        is JsonArray -> when {
            value.all { it !is JsonObject && it !is JsonArray } ->
                value.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.takeIf(String::isNotBlank) }.joinToString(", ")
            // Attendee lists and similar email-keyed rows read as addresses.
            value.all { (it as? JsonObject)?.get("email") is JsonPrimitive } -> value.joinToString(", ") {
                val row = it as JsonObject
                val email = (row["email"] as JsonPrimitive).content
                (row["displayName"] as? JsonPrimitive)?.contentOrNull?.takeIf(String::isNotBlank)?.let { name -> "$name <$email>" } ?: email
            }
            else -> value.map { format(it, depth + 1) }.filter(String::isNotEmpty).joinToString("\n")
        }
        is JsonObject -> if (depth >= 2) deepObject(value) else value.entries
            .filter { (k, _) -> k !in hiddenKeys }
            .map { (k, v) -> "${humanize(k)}: ${format(v, depth + 1)}" }
            .filterNot { it.trimEnd().endsWith(":") }
            .joinToString("\n")
    }

    /** Provider bookkeeping a reviewer has no use for (calendar extended properties and the like). */
    private val hiddenKeys = setOf("extendedProperties", "extended_properties", "conferenceDataVersion")

    /** Past two levels: a time or an address reads as itself, CREW's own bookkeeping as nothing, the rest as a literal. */
    private fun deepObject(value: JsonObject): String {
        fun text(key: String) = (value[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
        return text("dateTime") ?: text("date") ?: text("email")
            ?: if ("crewApprovalId" in value || "crewArgsHash" in value) "" else value.toString()
    }

    /** Plain text from a decoded Gmail message snapshot (gmail_send_draft). */
    private fun decodedText(message: JsonObject): String {
        fun walk(part: JsonElement?): List<String> {
            val obj = part as? JsonObject ?: return emptyList()
            val own = if ((obj["mimeType"] as? JsonPrimitive)?.contentOrNull == "text/plain") {
                listOfNotNull((obj["decodedText"] as? JsonPrimitive)?.contentOrNull)
            } else emptyList()
            return own + ((obj["parts"] as? JsonArray)?.flatMap(::walk) ?: emptyList())
        }
        return walk(message["payload"]).joinToString("\n\n").ifEmpty { (message["snippet"] as? JsonPrimitive)?.contentOrNull.orEmpty() }
    }

    fun fields(args: JsonElement?): List<Pair<String, String>> {
        val obj = args as? JsonObject ?: return emptyList()
        val out = mutableListOf<Pair<String, String>>()
        fun push(label: String, value: String?) { if (!value.isNullOrBlank()) out += label to value }
        for ((key, value) in obj) {
            if (key == "reviewed_raw" || key in hiddenKeys) continue
            if (key == "reviewed_message" && value is JsonObject) {
                val headers = ((value["payload"] as? JsonObject)?.get("headers") as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
                fun header(name: String) = headers.firstOrNull { (it["name"] as? JsonPrimitive)?.contentOrNull == name }
                    ?.let { (it["value"] as? JsonPrimitive)?.contentOrNull }
                push("To", header("To"))
                push("Subject", header("Subject"))
                push("Body", decodedText(value))
                continue
            }
            push(humanize(key), format(value))
        }
        return out
    }
}
