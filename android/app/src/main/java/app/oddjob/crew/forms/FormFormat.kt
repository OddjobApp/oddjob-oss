package app.oddjob.crew.forms

import java.text.NumberFormat
import java.util.Currency
import java.util.Locale
import kotlin.math.abs

/** Port of formatValue in client/src/modules/forms/ResultBlocks.tsx. */
object FormFormat {
    fun value(v: Any?, format: String?, locale: Locale = Locale.getDefault()): String = when (v) {
        null, "" -> "—"
        is Double -> number(v, format, locale)
        is Number -> number(v.toDouble(), format, locale)
        is Boolean -> if (v) "Yes" else "No"
        is List<*> -> v.joinToString(", ") { JsValues.toStr(it) }
        is Map<*, *> -> (v["address"] as? String) ?: "Location set"
        else -> v.toString()
    }

    private fun number(d: Double, format: String?, locale: Locale): String {
        if (!d.isFinite()) return "—"
        return when (format) {
            "currency" -> NumberFormat.getCurrencyInstance(locale).apply { currency = Currency.getInstance("USD") }.format(d)
            "percent" -> NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1 }.format(d) + "%"
            else -> NumberFormat.getNumberInstance(locale).apply {
                maximumFractionDigits = if (abs(d) < 1 && d != 0.0) 4 else 2
            }.format(d)
        }
    }

    /** A number as the web's choice scale labels it: 3, not 3.0. */
    fun plain(d: Double): String = JsValues.numberToString(d)
}
