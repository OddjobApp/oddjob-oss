package app.oddjob.crew.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/*
 * QuickBooks results, financial calculations, forecasts and snapshots, as the
 * crew returns them inside google_workspace_results items (platform
 * "quickbooks"). Ports of shared/crew-money.ts and the web's
 * FinancialReportItemView / CalculationItemView / ForecastItemView /
 * FinancialSnapshotItemView, so a figure reads the same on both.
 */

private fun JsonObject.s(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
private fun JsonObject.objs(key: String): List<JsonObject> = (this[key] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
private fun JsonObject.strs(key: String): List<String> = (this[key] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()

object CrewMoney {
    private val code = Regex("""^[A-Z]{3}\s+|\s+[A-Z]{3}$""")
    private val number = Regex("""^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$""")

    /**
     * A source amount for display, without changing it: "—" for nothing, the
     * raw text when it is not a number, else currency formatting in en-US with
     * at least two decimals (shared/crew-money.ts formatCrewMoney).
     */
    fun format(value: String?, currency: String? = "USD"): String {
        if (value.isNullOrBlank()) return "—"
        val raw = value.trim()
        val normalized = raw.replace(code, "").replace(Regex("[$€£¥,]"), "").replace(Regex("""^\((.*)\)$"""), "-$1")
        if (!number.matches(normalized)) return raw
        val amount = runCatching { BigDecimal(normalized) }.getOrNull() ?: return "—"
        val cur = currency?.takeIf { it.isNotBlank() } ?: "USD"
        return runCatching {
            val c = Currency.getInstance(cur)
            NumberFormat.getCurrencyInstance(Locale.US).apply {
                this.currency = c
                minimumFractionDigits = 2
                maximumFractionDigits = maxOf(2, c.defaultFractionDigits)
            }.format(amount)
        }.getOrElse { "%.2f %s".format(amount.toDouble(), cur) }
    }
}

data class ReportRow(val cells: List<String>, val sectionHeader: Boolean, val summary: Boolean, val majorTotal: Boolean)
data class ReportKpi(val label: String, val value: String, val highlight: Boolean)
data class FinancialReport(val columns: List<String>, val rows: List<ReportRow>, val kpis: List<ReportKpi>)

object FinancialReports {
    private val majorTotal = Regex("^(net income|net profit|total income|total revenue|gross profit|total expenses|total assets|total liabilities|total equity|net cash)", RegexOption.IGNORE_CASE)
    private val totalWord = Regex("""^(total|net|gross)\b""", RegexOption.IGNORE_CASE)

    /** A QuickBooks report body ("|"-separated lines) as columns, rows and headline totals. */
    fun parse(body: String?, currency: String?, moneyColumns: List<Int>?): FinancialReport {
        val lines = body.orEmpty().split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        if (lines.isEmpty()) return FinancialReport(listOf("Account / Line Item", "Amount"), emptyList(), emptyList())
        val first = lines[0].split('|').map { it.trim() }
        val isHeader = first.size > 1 && (
            first[0].isEmpty() ||
                Regex("^(account|description|line item|name|customer|vendor)", RegexOption.IGNORE_CASE).containsMatchIn(first[0]) ||
                (!Regex("""\d""").containsMatchIn(first.last()) && lines.size > 1)
            )
        val columns: List<String>
        val data: List<String>
        if (isHeader) {
            columns = first.mapIndexed { i, c -> c.ifEmpty { if (i == 0) "Account / Line Item" else "Total" } }
            data = lines.drop(1)
        } else {
            val max = maxOf(lines.maxOf { it.split('|').size }, 2)
            columns = listOf("Account / Line Item") + (0 until max - 1).map { i -> if (i == max - 2) "Total" else "Amount ${i + 1}" }
            data = lines
        }
        val nonMoney = Regex("""percent|%|quantity|count|date|number|num\b|id\b""", RegexOption.IGNORE_CASE)
        val rows = mutableListOf<ReportRow>()
        val kpis = mutableListOf<ReportKpi>()
        val seen = mutableSetOf<String>()
        for (line in data) {
            val cells = line.split('|').mapIndexed { i, c ->
                val t = c.trim()
                val money = currency != null && t.isNotEmpty() && i > 0 &&
                    (moneyColumns?.contains(i) ?: !nonMoney.containsMatchIn(columns.getOrElse(i) { "" }))
                if (money) CrewMoney.format(t, currency) else t
            }
            val firstCell = cells.firstOrNull().orEmpty()
            val others = cells.drop(1)
            val hasValues = others.any { it.isNotEmpty() && !Regex("""^[-–—\s]+$""").matches(it) }
            val isMajor = majorTotal.containsMatchIn(firstCell)
            if ((isMajor || (Regex("""^total\b""", RegexOption.IGNORE_CASE).containsMatchIn(firstCell) && data.size <= 5)) && others.isNotEmpty()) {
                val last = others.lastOrNull { it.isNotEmpty() }
                if (last != null && seen.add(firstCell.lowercase())) {
                    kpis += ReportKpi(firstCell, last, Regex("^(net income|net profit|gross profit|net cash)", RegexOption.IGNORE_CASE).containsMatchIn(firstCell))
                }
            }
            rows += ReportRow(
                cells = cells,
                sectionHeader = !hasValues && firstCell.isNotEmpty() && !totalWord.containsMatchIn(firstCell),
                summary = totalWord.containsMatchIn(firstCell),
                majorTotal = isMajor,
            )
        }
        return FinancialReport(columns, rows, kpis)
    }
}

/** A verified total over QuickBooks records (CalculationItemView). */
data class FinancialCalculation(val field: String, val entity: String, val filter: String, val matchedRecords: Int, val totals: List<Triple<String, String, Int>>) {
    val heading: String get() = if (this.field == "Balance") "Outstanding balance" else "Total ${this.field}"

    companion object {
        fun parse(o: JsonObject?): FinancialCalculation? {
            o ?: return null
            return FinancialCalculation(
                field = o.s("field") ?: return null,
                entity = o.s("entity").orEmpty(),
                filter = o.s("filter").orEmpty(),
                matchedRecords = o.s("matchedRecords")?.toIntOrNull() ?: 0,
                totals = o.objs("totals").map { Triple(it.s("currency") ?: "USD", it.s("value").orEmpty(), it.s("count")?.toIntOrNull() ?: 0) },
            )
        }
    }
}

/** A projection (ForecastItemView): one value per period, with scenarios beside it. */
data class FinancialForecast(
    val method: String,
    val currency: String,
    val periodUnit: String,
    val asOf: String?,
    val periods: List<String>,
    val values: List<String?>,
    val scenarios: List<Pair<String, List<String?>>>,
    val assumptions: List<String>,
    val warnings: List<String>,
    val assessment: String?,
) {
    val valueLabel: String get() = if (method in setOf("cashflow", "three_statement")) "Ending cash" else "Projected value"

    companion object {
        fun parse(o: JsonObject?): FinancialForecast? {
            o ?: return null
            val series = o.objs("series")
            if (series.isEmpty()) return null
            val assessment = (o["predictionAssessment"] as? JsonObject)?.let { a ->
                val label = a.s("predicted_label")?.replace('_', ' ') ?: return@let null
                val confidence = a.s("confidence")?.toDoubleOrNull() ?: return@let null
                "Prediction-engine assessment: $label. Confidence ${"%.1f".format(confidence * 100)}% (heuristic; preview is uncalibrated)."
            }
            return FinancialForecast(
                method = o.s("method") ?: "projection",
                currency = o.s("currency") ?: "USD",
                periodUnit = o.s("periodUnit") ?: "period",
                asOf = o.s("asOf"),
                periods = series.map { it.s("period").orEmpty() },
                values = series.map { it.s("value") },
                scenarios = o.objs("scenarios").map { sc -> (sc.s("name") ?: "Scenario") to sc.objs("series").map { it.s("value") } },
                assumptions = o.strs("assumptions"),
                warnings = o.strs("warnings"),
                assessment = assessment,
            )
        }
    }
}

/** A frozen set of figures (FinancialSnapshotItemView), saved by the person, or compared with an earlier one. */
data class FinancialSnapshot(
    val id: String,
    val name: String,
    val saved: Boolean,
    val organizationId: Int?,
    val sessionKey: String,
    val period: String?,
    val capturedAt: String?,
    val metrics: List<Triple<String, String, String>>,
    val assumptions: List<String>,
    val exclusions: List<String>,
) {
    companion object {
        fun parse(o: JsonObject?): FinancialSnapshot? {
            o ?: return null
            val start = o.s("periodStart")
            val end = o.s("periodEnd")
            return FinancialSnapshot(
                id = o.s("id") ?: return null,
                name = o.s("name") ?: "Snapshot",
                saved = o.s("status") == "saved",
                organizationId = o.s("organizationId")?.toIntOrNull(),
                sessionKey = o.s("sessionKey") ?: return null,
                period = if (start != null && end != null) "$start → $end" else null,
                capturedAt = o.s("capturedAt"),
                metrics = o.objs("metrics").map { Triple(it.s("label").orEmpty(), it.s("value").orEmpty(), it.s("currency") ?: "USD") },
                assumptions = o.strs("assumptions"),
                exclusions = o.strs("exclusions"),
            )
        }
    }
}

data class SnapshotComparison(val baseline: String, val current: String, val rows: List<List<String>>, val warnings: List<String>) {
    companion object {
        fun parse(o: JsonObject?): SnapshotComparison? {
            o ?: return null
            val base = (o["baseline"] as? JsonObject)?.s("name") ?: return null
            val cur = (o["current"] as? JsonObject)?.s("name") ?: return null
            return SnapshotComparison(
                baseline = base,
                current = cur,
                rows = o.objs("rows").map { r ->
                    val c = r.s("currency")
                    listOf(
                        r.s("label").orEmpty(),
                        CrewMoney.format(r.s("baseline"), c),
                        CrewMoney.format(r.s("current"), c),
                        CrewMoney.format(r.s("change"), c),
                        r.s("percent")?.let { "$it%" } ?: "—",
                    )
                },
                warnings = o.strs("warnings"),
            )
        }
    }
}
