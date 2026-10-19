package app.oddjob.crew.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * stage-confirmation-display.ts: form and stage cards post a person's answers
 * as their own turn with JSON attached for the agents. The room shows a
 * readable summary instead; the stored message is unchanged. [summary] is
 * null for any message that is not one of these, so it shows as written.
 */
object TurnDisplay {
    private val stage = Regex("""^I (confirmed|completed) stage\s+"([^"]{1,60})"\s+with configuration:\s*(\{[\s\S]*)$""", RegexOption.IGNORE_CASE)
    private val form = Regex("""^I submitted the\s+"([^"]{1,120})"(?:\s+form)?\s+with:\s*(\{[\s\S]*)$""", RegexOption.IGNORE_CASE)
    private val intake = Regex("""^\[DIVERSE PRIMITIVE INTAKE:\s*([^\]]{1,80})]\s*\n•\s*Direction \(D\):\s*([^\n]*)""")

    private const val MAX_FIELDS = 4
    private const val MAX_VALUE = 60

    fun summary(content: String): String? {
        val text = content.trim()
        return stageMessage(text) ?: formMessage(text) ?: intakeMessage(text)
    }

    private fun stageMessage(text: String): String? {
        val m = stage.find(text) ?: return null
        val data = parseObject(m.groupValues[3]) ?: return null
        val verb = if (m.groupValues[1].equals("completed", ignoreCase = true)) "Completed" else "Confirmed"
        val packs = (data["selectedPacks"] ?: data["selectedPackIds"]) as? JsonArray
        if (packs != null && packs.all { (it as? JsonPrimitive)?.isString == true }) {
            return "$verb architecture with ${packs.size} selected ${if (packs.size == 1) "pack" else "packs"}."
        }
        return "$verb stage configuration."
    }

    private fun formMessage(text: String): String? {
        val m = form.find(text) ?: return null
        val data = leadingObject(m.groupValues[2]) ?: return null
        val fields = summarizeFields(data)
        val title = m.groupValues[1]
        return if (fields.isNotEmpty()) "Submitted “$title”: $fields" else "Submitted “$title”."
    }

    private fun intakeMessage(text: String): String? {
        val m = intake.find(text) ?: return null
        val label = m.groupValues[1].trim().lowercase().replaceFirstChar(Char::uppercase)
        val direction = m.groupValues[2].trim()
        return if (direction.isNotEmpty()) "Started $label setup: $direction" else "Started $label setup."
    }

    private fun parseObject(raw: String): JsonObject? = runCatching { CrewJson.parseToJsonElement(raw) as? JsonObject }.getOrNull()

    /** The JSON object at the start of [raw], found by matching braces (strings respected), so text may follow it. */
    private fun leadingObject(raw: String): JsonObject? {
        var depth = 0
        var inString = false
        var i = 0
        while (i < raw.length) {
            val ch = raw[i]
            if (inString) {
                if (ch == '\\') i++ else if (ch == '"') inString = false
            } else when (ch) {
                '"' -> inString = true
                '{' -> depth++
                '}' -> if (--depth == 0) return parseObject(raw.substring(0, i + 1))
            }
            i++
        }
        return null
    }

    /** "Name: Acme · Email: a@b.io · +2 more"; internal keys (`_trace`, `body_format`) and nested objects are left out. */
    private fun summarizeFields(data: JsonObject): String {
        val shown = mutableListOf<String>()
        var hidden = 0
        for ((key, value) in data) {
            if (key.startsWith("_") || key == "body_format") continue
            val text = when (value) {
                is JsonArray -> value.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.joinToString(", ")
                is JsonPrimitive -> value.contentOrNull.orEmpty()
                else -> ""
            }
            if (text.isBlank()) continue
            if (shown.size >= MAX_FIELDS) { hidden++; continue }
            val short = if (text.length > MAX_VALUE) text.take(MAX_VALUE - 1) + "…" else text
            shown += "${fieldLabel(key)}: $short"
        }
        return shown.joinToString(" · ") + if (hidden > 0) " · +$hidden more" else ""
    }

    private fun fieldLabel(key: String): String =
        key.replace(Regex("[_-]+"), " ").replace(Regex("([a-z])([A-Z])"), "$1 $2").trim().lowercase()
            .replaceFirstChar(Char::uppercase)
}
