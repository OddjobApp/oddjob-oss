package app.oddjob.crew.ui.cards

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.oddjob.crew.data.CrewJson
import app.oddjob.crew.forms.FormEvaluation
import app.oddjob.crew.forms.FormField
import app.oddjob.crew.forms.FormFormat
import app.oddjob.crew.forms.FormSpec
import app.oddjob.crew.forms.FormSpecs
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** Inputs survive rotation as a JSON string. */
private val InputsSaver = Saver<Map<String, JsonElement>, String>(
    save = { JsonObject(it).toString() },
    restore = { runCatching { CrewJson.parseToJsonElement(it).jsonObject.toMap() }.getOrDefault(emptyMap()) },
)

/**
 * An `assistant_form` card. Submitting sends the same chat message the web form
 * sends, so the crew reacts to a phone submission exactly as to a browser one.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FormCard(
    spec: FormSpec,
    stateKey: String,
    alreadySubmitted: Boolean,
    enabled: Boolean,
    onSubmit: (String) -> Unit,
    /**
     * In place of [onSubmit] when submitting can be refused (an input request
     * the server must record): null on success, else why it was not submitted.
     */
    submitChecked: (suspend (String) -> String?)? = null,
) {
    var inputs by rememberSaveable(stateKey, stateSaver = InputsSaver) { mutableStateOf(spec.initialInputs) }
    var attempted by rememberSaveable(stateKey) { mutableStateOf(false) }
    var sentHere by rememberSaveable(stateKey) { mutableStateOf(false) }
    var submitting by rememberSaveable(stateKey) { mutableStateOf(false) }
    var submitError by rememberSaveable(stateKey) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val submitted = alreadySubmitted || sentHere
    val live: FormEvaluation = remember(inputs, attempted) { FormSpecs.evaluate(spec, inputs, validate = attempted) }
    val editable = enabled && !submitted && !submitting

    CardSurface {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (spec.title != null || spec.description != null) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    spec.title?.let { Text(it, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold) }
                    spec.description?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                HorizontalDivider()
            }
            val multiPage = spec.pages.size > 1
            for (page in spec.pages) {
                if (!app.oddjob.crew.forms.FormExpression.isVisible(page.visibleWhen, live.values)) continue
                if (multiPage) Text(page.title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                page.description?.takeIf { multiPage }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                for (field in spec.fields.filter { it.pageId == page.id }) {
                    if (!app.oddjob.crew.forms.FormExpression.isVisible(field.visibleWhen, live.values)) continue
                    FieldInput(
                        field = field,
                        value = inputs[field.key] ?: field.defaultValue,
                        computed = live.values[field.key],
                        error = live.errors[field.key]?.takeIf { attempted || field.type == "computed" },
                        enabled = editable && !field.readOnly,
                        onChange = { v -> inputs = inputs + (field.key to (v ?: JsonPrimitive(""))) },
                    )
                }
            }
            live.errors["formula"]?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }

            if (submitted) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Default.CheckCircle, null, tint = MaterialTheme.colorScheme.primary)
                    Text("Submitted", style = MaterialTheme.typography.labelLarge)
                }
            } else {
                submitError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                Button(
                    enabled = editable,
                    onClick = {
                        attempted = true
                        val result = FormSpecs.evaluate(spec, inputs, validate = true)
                        if (result.errors.isEmpty()) {
                            val message = FormSpecs.submissionMessage(spec, inputs, result.values)
                            if (submitChecked == null) {
                                sentHere = true
                                onSubmit(message)
                            } else {
                                submitting = true
                                submitError = null
                                scope.launch {
                                    val refused = submitChecked(message)
                                    submitting = false
                                    if (refused == null) sentHere = true else submitError = refused
                                }
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (submitting) "Submitting…" else spec.submitLabel) }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun FieldInput(
    field: FormField,
    value: JsonElement?,
    computed: Any?,
    error: String?,
    enabled: Boolean,
    onChange: (JsonElement?) -> Unit,
) {
    val text = (value as? JsonPrimitive)?.contentOrNull.orEmpty()
    val label = if (field.required) "${field.label} *" else field.label

    @Composable
    fun Help() {
        field.description?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
    }

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        when {
            field.type == "computed" -> Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = MaterialTheme.shapes.medium,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                    Text(
                        field.label.uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        FormFormat.value(computed, field.format),
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }

            field.type == "boolean" -> Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.clickable(enabled = enabled) {
                    onChange(JsonPrimitive(!((value as? JsonPrimitive)?.booleanOrNull ?: false)))
                },
            ) {
                Checkbox(
                    checked = (value as? JsonPrimitive)?.booleanOrNull == true,
                    onCheckedChange = { onChange(JsonPrimitive(it)) },
                    enabled = enabled,
                )
                Text(label, style = MaterialTheme.typography.bodyMedium)
            }

            field.type == "radio" || field.type == "multiselect" || field.choiceScale != null -> {
                Text(label, style = MaterialTheme.typography.bodyMedium)
                val multi = field.type == "multiselect"
                val scale = field.choiceScale
                val options = scale?.map { app.oddjob.crew.forms.FormOption(FormFormat.plain(it), FormFormat.plain(it)) } ?: field.options
                val selected: List<String> = when (value) {
                    is JsonArray -> value.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                    is JsonPrimitive -> listOfNotNull(value.contentOrNull?.let { c -> c.toDoubleOrNull()?.let(FormFormat::plain) ?: c })
                    else -> emptyList()
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    options.forEach { option ->
                        val checked = option.value in selected
                        FilterChip(
                            selected = checked,
                            enabled = enabled,
                            onClick = {
                                if (multi) {
                                    val next = if (checked) selected - option.value else selected + option.value
                                    onChange(JsonArray(next.map(::JsonPrimitive)))
                                } else if (scale != null) {
                                    onChange(JsonPrimitive(option.value.toDouble()))
                                } else {
                                    onChange(JsonPrimitive(option.value))
                                }
                            },
                            label = { Text(option.label) },
                        )
                    }
                }
            }

            field.type == "select" -> {
                var open by remember { mutableStateOf(false) }
                ExposedDropdownMenuBox(expanded = open, onExpandedChange = { if (enabled) open = it }) {
                    OutlinedTextField(
                        value = field.options.firstOrNull { it.value == text }?.label ?: "",
                        onValueChange = {},
                        readOnly = true,
                        enabled = enabled,
                        label = { Text(label) },
                        placeholder = { Text(field.placeholder ?: "Choose…") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
                        modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                    )
                    ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                        field.options.forEach { option ->
                            DropdownMenuItem(text = { Text(option.label) }, onClick = { open = false; onChange(JsonPrimitive(option.value)) })
                        }
                    }
                }
            }

            field.type == "date" || field.type == "datetime" || field.type == "time" ->
                DateTimeInput(field, label, text, enabled) { onChange(JsonPrimitive(it)) }

            field.type == "query" -> {
                Text(label, style = MaterialTheme.typography.bodyMedium)
                Text(
                    "This field is looked up on the server and isn't available on mobile.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            field.type == "location" || field.type == "geo" -> OutlinedTextField(
                // The web stores a picked place as an object with an address.
                value = ((value as? JsonObject)?.get("address") as? JsonPrimitive)?.contentOrNull ?: text,
                onValueChange = { onChange(if (it.isEmpty()) null else JsonObject(mapOf("address" to JsonPrimitive(it)))) },
                enabled = enabled,
                label = { Text(label) },
                placeholder = { Text(field.placeholder ?: "Address") },
                modifier = Modifier.fillMaxWidth(),
            )

            else -> OutlinedTextField(
                value = text,
                onValueChange = { onChange(if (it.isEmpty()) null else JsonPrimitive(it)) },
                enabled = enabled,
                label = { Text(label) },
                placeholder = field.placeholder?.let { { Text(it) } },
                suffix = field.unit?.let { { Text(it) } },
                minLines = if (field.type == "textarea" || field.type == "markdown") 3 else 1,
                singleLine = field.type != "textarea" && field.type != "markdown",
                keyboardOptions = KeyboardOptions(
                    keyboardType = when {
                        field.isNumeric -> KeyboardType.Decimal
                        field.type == "email" -> KeyboardType.Email
                        field.type == "url" -> KeyboardType.Uri
                        else -> KeyboardType.Text
                    },
                ),
                isError = error != null,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Help()
    }
}

/** Values in the HTML input formats the web sends: 2026-10-03, 14:30, 2026-10-03T14:30. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateTimeInput(field: FormField, label: String, text: String, enabled: Boolean, onChange: (String) -> Unit) {
    var step by remember { mutableStateOf<String?>(null) }
    var pickedDate by remember { mutableStateOf<String?>(null) }

    Box {
        OutlinedTextField(
            value = text,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(label) },
            placeholder = { Text(if (field.type == "time") "HH:MM" else if (field.type == "date") "YYYY-MM-DD" else "YYYY-MM-DD HH:MM") },
            modifier = Modifier.fillMaxWidth(),
        )
        // A transparent overlay takes the tap; a read-only field does not report clicks.
        Box(Modifier.matchParentSize().clickable(enabled = enabled) { step = if (field.type == "time") "time" else "date" })
    }

    when (step) {
        "date" -> {
            val state = rememberDatePickerState(
                initialSelectedDateMillis = runCatching {
                    LocalDate.parse(text.take(10)).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
                }.getOrNull(),
            )
            DatePickerDialog(
                onDismissRequest = { step = null },
                confirmButton = {
                    TextButton(onClick = {
                        val millis = state.selectedDateMillis
                        if (millis == null) { step = null; return@TextButton }
                        val date = Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().toString()
                        if (field.type == "datetime") { pickedDate = date; step = "time" } else { onChange(date); step = null }
                    }) { Text("OK") }
                },
                dismissButton = { TextButton(onClick = { step = null }) { Text("Cancel") } },
            ) { DatePicker(state) }
        }
        "time" -> {
            val existing = text.substringAfter('T', text).take(5).split(':')
            val state = rememberTimePickerState(
                initialHour = existing.getOrNull(0)?.toIntOrNull() ?: 9,
                initialMinute = existing.getOrNull(1)?.toIntOrNull() ?: 0,
                is24Hour = true,
            )
            androidx.compose.material3.AlertDialog(
                onDismissRequest = { step = null },
                confirmButton = {
                    TextButton(onClick = {
                        val time = "%02d:%02d".format(state.hour, state.minute)
                        onChange(if (field.type == "datetime") "${pickedDate ?: LocalDate.now()}T$time" else time)
                        step = null
                    }) { Text("OK") }
                },
                dismissButton = { TextButton(onClick = { step = null }) { Text("Cancel") } },
                text = { TimePicker(state) },
            )
        }
    }
}
