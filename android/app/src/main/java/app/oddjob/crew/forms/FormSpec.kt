package app.oddjob.crew.forms

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * An `assistant_form` turn artifact, read the way shared/form-studio-legacy.ts
 * (definitionFromLegacyForm) reads it, and evaluated the way
 * shared/form-studio.ts (evaluateStudio) evaluates it.
 */
data class FormOption(val value: String, val label: String)

data class FormField(
    val key: String,
    val label: String,
    val type: String,
    val pageId: String,
    val required: Boolean = false,
    val placeholder: String? = null,
    val description: String? = null,
    val readOnly: Boolean = false,
    val options: List<FormOption> = emptyList(),
    val formula: String? = null,
    val format: String? = null,
    val unit: String? = null,
    val min: Double? = null,
    val max: Double? = null,
    val visibleWhen: String? = null,
    val defaultValue: JsonElement? = null,
) {
    val isNumeric get() = type in NUMERIC_TYPES

    /** A bounded rating or slider of at most ten steps renders as choices, as on the web. */
    val choiceScale: List<Double>?
        get() {
            if (type != "rating" && type != "slider") return null
            val lo = min ?: return null
            val hi = max ?: return null
            if (hi < lo || hi - lo > 10) return null
            return (0..(hi - lo).toInt()).map { lo + it }
        }
}

data class FormPage(val id: String, val title: String, val description: String?, val visibleWhen: String? = null)

data class FormSpec(
    val title: String?,
    val description: String?,
    val submitLabel: String,
    val pages: List<FormPage>,
    val fields: List<FormField>,
    /** Values the form opens with, from `defaultValue`s with their {{ }} placeholders filled. */
    val initialInputs: Map<String, JsonElement>,
)

data class FormEvaluation(val values: Map<String, Any?>, val errors: Map<String, String>)

internal val NUMERIC_TYPES = setOf("number", "rating", "slider")

private val STUDIO_TYPES = setOf(
    "text", "number", "textarea", "markdown", "select", "multiselect", "radio", "rating", "slider", "boolean",
    "computed", "location", "geo", "date", "datetime", "time", "email", "url", "query",
)

private val TYPE_ALIASES = mapOf(
    "checkbox" to "boolean", "switch" to "boolean", "toggle" to "boolean",
    "password" to "text", "phone" to "text", "tel" to "text", "vin" to "text", "string" to "text",
    "integer" to "number", "float" to "number", "decimal" to "number", "currency" to "number",
    "dropdown" to "select", "multi_select" to "multiselect", "checkboxes" to "multiselect",
)

object FormSpecs {

    /** Null when the payload is not a renderable form (the web skips it then too). */
    fun parse(payload: JsonObject): FormSpec? {
        if (payload.str("type") != "assistant_form") return null
        val schema = payload["schema"] as? JsonObject
        val source: JsonObject = schema ?: JsonObject(mapOf("fields" to (payload["fields"] ?: JsonArray(emptyList()))))
        val hasFields = (source["fields"] as? JsonArray)?.isNotEmpty() == true ||
            (source["steps"] as? JsonArray)?.isNotEmpty() == true
        if (!hasFields) return null

        val context = payload["context"] as? JsonObject
        val title = payload.str("title")
        val description = payload.str("description")
        val submitLabel = payload.str("submitLabel") ?: "Submit"

        val studio = source["studio"] as? JsonObject
        if (studio != null) {
            // A Form Studio definition keeps its own pages and their conditions.
            val pages = (studio["pages"] as? JsonArray).orEmpty().mapIndexedNotNull { i, el ->
                val o = el as? JsonObject ?: return@mapIndexedNotNull null
                FormPage(o.str("id") ?: "page_${i + 1}", o.str("title") ?: "Page ${i + 1}", null, o.str("visibleWhen"))
            }.ifEmpty { listOf(FormPage("page_1", title ?: "Form", null)) }
            val fields = (source["fields"] as? JsonArray).orEmpty().mapIndexedNotNull { i, el ->
                (el as? JsonObject)?.let { mapField(it, i, it.str("pageId") ?: pages.first().id, context, keepCondition = true) }
            }
            // Studio definitions keep defaultValue on the field; evaluate() falls back to it.
            return FormSpec(title, description, submitLabel, pages, fields, emptyMap())
        }

        val steps = (source["steps"] as? JsonArray).orEmpty().filterIsInstance<JsonObject>()
        val pages: List<FormPage>
        val fields = mutableListOf<FormField>()
        if (steps.isNotEmpty()) {
            pages = steps.mapIndexed { i, s ->
                FormPage(s.str("id") ?: "step_${i + 1}", s.str("title") ?: "Step ${i + 1}", s.str("description"))
            }
            val seen = mutableSetOf<String>()
            steps.forEachIndexed { stepIndex, step ->
                val stepFields = (step["fields"] as? JsonArray).orEmpty().filterIsInstance<JsonObject>()
                stepFields.forEachIndexed { fieldIndex, f ->
                    val mapped = mapField(f, fields.size + fieldIndex, pages[stepIndex].id, context)
                    if (seen.add(mapped.key)) fields += mapped
                }
            }
            (source["fields"] as? JsonArray).orEmpty().filterIsInstance<JsonObject>().forEachIndexed { i, f ->
                val mapped = mapField(f, fields.size + i, pages.first().id, context)
                if (seen.add(mapped.key)) fields += mapped
            }
        } else {
            pages = listOf(FormPage("page_1", title ?: source.str("title") ?: "Form", source.str("description")))
            (source["fields"] as? JsonArray).orEmpty().filterIsInstance<JsonObject>().forEachIndexed { i, f ->
                fields += mapField(f, i, "page_1", context)
            }
        }
        val legacyDefaults = fields.mapNotNull { f -> f.defaultValue?.let { f.key to it } }.toMap()
        return FormSpec(title, description, submitLabel, pages, fields.map { it.copy(defaultValue = null) }, legacyDefaults)
    }

    private fun mapField(f: JsonObject, index: Int, pageId: String, context: JsonObject?, keepCondition: Boolean = false): FormField {
        val key = f.str("key") ?: f.str("id") ?: f.str("name") ?: "field_${index + 1}"
        val rawDefault = f["defaultValue"]
        val default = when {
            rawDefault is JsonPrimitive && rawDefault.isString -> JsonPrimitive(fillTemplate(rawDefault.content, context))
            rawDefault == null || rawDefault is JsonNull -> null
            else -> rawDefault
        }?.takeUnless { it is JsonPrimitive && it.isString && it.content.isEmpty() }
        return FormField(
            key = key,
            label = f.str("label") ?: f.str("name") ?: key,
            type = studioType(f.str("type")),
            pageId = pageId,
            required = f["required"]?.let { (it as? JsonPrimitive)?.booleanOrNull } == true,
            placeholder = f.str("placeholder"),
            description = f.str("description"),
            readOnly = f["readOnly"]?.let { (it as? JsonPrimitive)?.booleanOrNull } == true,
            options = (f["options"] as? JsonArray).orEmpty().mapNotNull { o ->
                when (o) {
                    is JsonPrimitive -> o.contentOrNull?.let { FormOption(it, it) }
                    is JsonObject -> o.str("value")?.let { FormOption(it, o.str("label") ?: it) }
                    else -> null
                }
            },
            formula = f.str("formula"),
            format = f.str("format"),
            unit = f.str("unit"),
            min = (f["min"] as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull,
            max = (f["max"] as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull,
            visibleWhen = if (keepCondition) f.str("visibleWhen") else null,
            defaultValue = default,
        )
    }

    private fun studioType(type: String?): String {
        val raw = type?.trim()?.lowercase().orEmpty()
        if (raw in STUDIO_TYPES) return raw
        return TYPE_ALIASES[raw] ?: "text"
    }

    /** {{ path.to.value }} placeholders filled from the payload's context. */
    fun fillTemplate(template: String, context: JsonObject?): String {
        if (context == null) return template
        return Regex("\\{\\{([^}]+)\\}\\}").replace(template) { m ->
            var value: JsonElement? = context
            for (part in m.groupValues[1].trim().split('.')) {
                value = (value as? JsonObject)?.get(part) ?: return@replace ""
            }
            when (val v = value) {
                null, is JsonNull -> ""
                is JsonPrimitive -> v.content
                else -> v.toString()
            }
        }
    }

    // ---- Evaluation (evaluateStudio) -------------------------------------

    fun evaluate(spec: FormSpec, inputs: Map<String, JsonElement>, validate: Boolean): FormEvaluation {
        val values = LinkedHashMap<String, Any?>()
        val errors = LinkedHashMap<String, String>()

        for (f in spec.fields.filter { it.type != "computed" }) {
            val raw = toJs(inputs[f.key] ?: f.defaultValue) ?: ""
            val absent = raw == "" || (raw is List<*> && raw.isEmpty())
            values[f.key] = when {
                f.isNumeric -> if (absent) "" else JsValues.number(raw)
                f.type == "boolean" -> raw == true || raw == "true"
                f.type == "multiselect" -> if (absent) "" else if (raw is List<*>) raw.map { JsValues.toStr(it) } else listOf(JsValues.toStr(raw))
                else -> raw
            }
            if (absent) continue
            val v = values[f.key]
            if (f.isNumeric && v is Double && (!v.isFinite() || (f.min != null && v < f.min) || (f.max != null && v > f.max))) {
                errors[f.key] = "Enter a number within the allowed range."
            }
            if (f.options.isNotEmpty()) {
                val allowed = f.options.map { it.value }.toSet()
                val chosen: List<Any?> = (v as? List<*>) ?: listOf(raw)
                if (!chosen.all { it is String && it in allowed }) errors[f.key] = "Choose an available option."
            }
        }

        try {
            for (f in orderedComputed(spec.fields)) {
                when (val outcome = FormExpression.evaluate(f.formula.orEmpty(), values)) {
                    is ExpressionOutcome.Value -> values[f.key] = outcome.value
                    // An unanswered input is not an error; the field just has no value yet.
                    is ExpressionOutcome.Missing -> values[f.key] = ""
                    is ExpressionOutcome.Error -> errors[f.key] = outcome.message
                }
            }
        } catch (e: IllegalStateException) {
            errors["formula"] = e.message ?: "Circular formula dependency"
        }

        if (validate) {
            val firstPage = spec.pages.firstOrNull()?.id
            for (f in spec.fields) {
                if (f.type == "computed" || !f.required) continue
                val page = spec.pages.firstOrNull { it.id == (f.pageId.ifEmpty { firstPage }) }
                if (!FormExpression.isVisible(page?.visibleWhen, values) || !FormExpression.isVisible(f.visibleWhen, values)) continue
                if (f.type == "boolean") {
                    if (values[f.key] != true) errors[f.key] = "This must be checked."
                } else if (values[f.key].let { it == null || it == "" }) {
                    errors[f.key] = "This field is required."
                }
            }
        }
        return FormEvaluation(values, errors)
    }

    /** Computed fields in dependency order, so a formula may read one declared below it. */
    fun orderedComputed(fields: List<FormField>): List<FormField> {
        val computed = fields.filter { it.type == "computed" }.associateBy { it.key }
        val visited = mutableSetOf<String>()
        val active = mutableSetOf<String>()
        val result = mutableListOf<FormField>()
        fun visit(name: String) {
            if (name in visited) return
            check(name !in active) { "Circular formula dependency: $name" }
            active += name
            val field = computed.getValue(name)
            val refs = runCatching { FormExpression.references(field.formula.orEmpty()) }.getOrDefault(emptyList())
            for (ref in refs) if (ref in computed) visit(ref)
            active -= name
            visited += name
            result += field
        }
        computed.keys.forEach(::visit)
        return result
    }

    /**
     * The chat message the web sends for a submitted form: TurnRow's
     * `I submitted the "${p.title ?? 'form'}" with: ${JSON.stringify({ ...inputs, ...values })}`.
     * Key order follows that spread: inputs in the order they were entered, then
     * the evaluated values, so a phone submission reads exactly like a browser one.
     */
    fun submissionMessage(spec: FormSpec, inputs: Map<String, JsonElement>, values: Map<String, Any?>): String {
        val data = LinkedHashMap<String, Any?>()
        inputs.forEach { (k, v) -> data[k] = toJs(v) }
        values.forEach { (k, v) -> data[k] = v }
        val json = data.entries.joinToString(",", "{", "}") { (k, v) -> jsonString(k) + ":" + jsonValue(v) }
        return "I submitted the \"${spec.title ?: "form"}\" with: $json"
    }

    /** The prefix a later user turn starts with once this form has been sent. */
    fun submissionPrefix(spec: FormSpec): String = "I submitted the \"${spec.title ?: "form"}\" with:"

    // ---- JS value bridge --------------------------------------------------

    fun toJs(element: JsonElement?): Any? = when (element) {
        null, is JsonNull -> null
        is JsonPrimitive -> when {
            element.isString -> element.content
            element.booleanOrNull != null -> element.booleanOrNull
            else -> element.doubleOrNull
        }
        is JsonArray -> element.map { toJs(it) }
        is JsonObject -> element.mapValues { toJs(it.value) }
    }

    private fun jsonValue(v: Any?): String = when (v) {
        null -> "null"
        is Double -> if (v.isFinite()) JsValues.numberToString(v) else "null"
        is Number -> JsValues.numberToString(v.toDouble())
        is Boolean -> v.toString()
        is String -> jsonString(v)
        is List<*> -> v.joinToString(",", "[", "]") { jsonValue(it) }
        is Map<*, *> -> v.entries.joinToString(",", "{", "}") { jsonString(it.key.toString()) + ":" + jsonValue(it.value) }
        else -> jsonString(v.toString())
    }

    /** JSON.stringify for a string. */
    private fun jsonString(s: String): String = JsonPrimitive(s).toString()

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
    private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()
}
