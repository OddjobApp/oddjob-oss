package app.oddjob.crew.forms

import app.oddjob.crew.data.CrewJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Parity with the TypeScript form engine. `form-parity.json` is produced by
 * running shared/form-expression.ts and shared/form-studio.ts themselves (see
 * the README for the regeneration command), so these assertions are the web's
 * answers, not expectations written by hand.
 */
class FormParityTest {
    private val fixture = CrewJson.parseToJsonElement(
        javaClass.classLoader!!.getResource("form-parity.json")!!.readText(),
    ).jsonObject

    @Suppress("UNCHECKED_CAST")
    private val scope = FormSpecs.toJs(fixture["scope"]) as Map<String, Any?>

    @Test
    fun everyExpressionMatchesTheWeb() {
        val cases = fixture["expressions"]!!.jsonArray
        assertTrue("fixture is empty", cases.size > 50)
        val failures = mutableListOf<String>()
        for (case in cases.map { it.jsonObject }) {
            val expr = case["expr"]!!.jsonPrimitive.content
            val outcome = FormExpression.evaluate(expr, scope)
            val expectOk = case["ok"]!!.jsonPrimitive.booleanOrNull == true
            val actual = when (outcome) {
                is ExpressionOutcome.Value -> "ok:" + JsValues.toStr(outcome.value)
                is ExpressionOutcome.Missing -> "missing:" + outcome.names.joinToString(",")
                is ExpressionOutcome.Error -> "error:" + outcome.message
            }
            val expected = when {
                expectOk -> "ok:" + case["str"]!!.jsonPrimitive.content
                case["missing"] !is JsonNull -> "missing:" + case["missing"]!!.jsonArray.joinToString(",") { it.jsonPrimitive.content }
                else -> "error:" + case["error"]!!.jsonPrimitive.content
            }
            if (actual != expected) failures += "$expr\n    web:    $expected\n    mobile: $actual"
        }
        assertTrue("Diverges from shared/form-expression.ts:\n" + failures.joinToString("\n"), failures.isEmpty())
    }

    @Test
    fun formsValidateAndSubmitLikeTheWeb() {
        val forms = fixture["forms"]!!.jsonArray.map { it.jsonObject }
        assertEquals(4, forms.size)
        for (form in forms) {
            val payload = JsonObject(
                mapOf(
                    "type" to JsonPrimitive("assistant_form"),
                    "title" to form["title"]!!,
                    "schema" to form["schema"]!!,
                ),
            )
            val spec = FormSpecs.parse(payload)!!
            val inputs = spec.initialInputs + form["inputs"]!!.jsonObject
            val result = FormSpecs.evaluate(spec, inputs, validate = true)

            val expectedErrors = form["errors"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }
            assertEquals("errors for ${form["inputs"]}", expectedErrors, result.errors)
            if (expectedErrors.isEmpty()) {
                assertEquals(
                    form["message"]!!.jsonPrimitive.content,
                    FormSpecs.submissionMessage(spec, inputs, result.values),
                )
            }
        }
    }

    @Test
    fun legacyAliasesAndDefaults() {
        val payload = CrewJson.parseToJsonElement(
            """
            {"type":"assistant_form","title":"T","context":{"user":{"name":"Ada"}},
             "schema":{"fields":[
               {"name":"who","type":"string","defaultValue":"Hi {{ user.name }}"},
               {"key":"n","type":"integer"},{"key":"c","type":"toggle"},{"key":"d","type":"dropdown","options":["x"]},
               {"key":"q","type":"something-new"}]}}
            """.trimIndent(),
        ).jsonObject
        val spec = FormSpecs.parse(payload)!!
        assertEquals(listOf("text", "number", "boolean", "select", "text"), spec.fields.map { it.type })
        assertEquals("Hi Ada", (spec.initialInputs["who"] as JsonPrimitive).contentOrNull)
    }

    @Test
    fun notAFormWithoutFields() {
        val empty = JsonObject(mapOf("type" to JsonPrimitive("assistant_form"), "schema" to JsonObject(mapOf("fields" to JsonArray(emptyList())))))
        assertEquals(null, FormSpecs.parse(empty))
    }

    @Test
    fun formatting() {
        val us = java.util.Locale.US
        assertEquals("$1,896.20", FormFormat.value(1896.204070478896, "currency", us))
        assertEquals("12.3%", FormFormat.value(12.345, "percent", us))
        assertEquals("0.1235", FormFormat.value(0.123456, null, us))
        assertEquals("—", FormFormat.value("", null, us))
        assertEquals("Yes", FormFormat.value(true, null, us))
    }
}
