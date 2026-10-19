package app.oddjob.crew.data

import app.oddjob.crew.ui.cards.CardKind
import app.oddjob.crew.ui.cards.TurnCards
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FinancialTest {
    private fun obj(json: String): JsonObject = CrewJson.parseToJsonElement(json).jsonObject

    @Test
    fun moneyMatchesTheWebFormatterExactly() {
        // Expected strings generated from shared/crew-money.ts formatCrewMoney.
        val cases = listOf(
            Triple("1234.5", "USD", "$1,234.50"),
            Triple("(500)", "USD", "-$500.00"),
            Triple("EUR 10", "EUR", "€10.00"),
            Triple("abc", "USD", "abc"),
            Triple("", "USD", "—"),
            Triple(null, "USD", "—"),
            Triple("1234", "JPY", "¥1,234.00"),
            Triple("-0.5", "GBP", "-£0.50"),
            Triple("1,000.25 USD", "USD", "$1,000.25"),
            Triple("12.3456", "USD", "$12.35"),
            Triple("5", "currency unverified", "5.00 currency unverified"),
        )
        cases.forEach { (value, currency, expected) -> assertEquals("$value $currency", expected, CrewMoney.format(value, currency)) }
    }

    @Test
    fun aReportReadsColumnsSectionsAndHeadlineTotals() {
        val report = FinancialReports.parse(
            "|Total\nIncome|\nSales|1200\nTotal Income|1200\nExpenses|\nRent|300\nNet Income|900",
            currency = "USD",
            moneyColumns = listOf(1),
        )
        assertEquals(listOf("Account / Line Item", "Total"), report.columns)
        assertTrue(report.rows[0].sectionHeader) // "Income"
        assertEquals(listOf("Sales", "$1,200.00"), report.rows[1].cells)
        assertTrue(report.rows[2].summary && report.rows[2].majorTotal)
        assertEquals(listOf("Total Income" to "$1,200.00", "Net Income" to "$900.00"), report.kpis.map { it.label to it.value })
        assertTrue(report.kpis.last().highlight)
    }

    @Test
    fun calculationsForecastsAndSnapshotsParse() {
        val calc = FinancialCalculation.parse(obj("""{"operation":"SUM","field":"Balance","entity":"Invoice","matchedRecords":3,"complete":true,"filter":"Balance > 0","totals":[{"currency":"USD","value":"450.10","count":3}]}"""))!!
        assertEquals("Outstanding balance", calc.heading)
        assertEquals(Triple("USD", "450.10", 3), calc.totals.single())

        val forecast = FinancialForecast.parse(obj(
            """{"method":"cashflow","currency":"USD","periodUnit":"month","series":[{"period":"2026-11","value":"100"},{"period":"2026-12","value":"80"}],
               "scenarios":[{"name":"Low","series":[{"value":"90"},{"value":"60"}]}],"assumptions":["a"],"warnings":[],
               "predictionAssessment":{"predicted_label":"cash_shortfall","confidence":0.42}}""",
        ))!!
        assertEquals("Ending cash", forecast.valueLabel)
        assertEquals(listOf("2026-11", "2026-12"), forecast.periods)
        assertEquals(listOf("90", "60"), forecast.scenarios.single().second)
        assertTrue(forecast.assessment!!.contains("cash shortfall. Confidence 42.0%"))

        val snap = FinancialSnapshot.parse(obj(
            """{"id":"8c3e1d4a-0000-4000-8000-000000000001","name":"Q3 close","status":"draft","organizationId":342,"sessionKey":"crew-1",
               "periodStart":"2026-07-01","periodEnd":"2026-09-30","metrics":[{"key":"rev","label":"Revenue","currency":"USD","value":"1200"}],"assumptions":[],"exclusions":[]}""",
        ))!!
        assertEquals(false, snap.saved)
        assertEquals("2026-07-01 → 2026-09-30", snap.period)
        assertNull(FinancialSnapshot.parse(obj("""{"name":"no id"}""")))
    }

    @Test
    fun quickBooksApprovalsShowTheProposalAndPostTheWebsLines() {
        val view = Approvals.fromCard(obj(
            """{"type":"approval_request","kind":"quickbooks_action","actionName":"quickbooks_record_payment","proposalId":21,"title":"Record payment",
               "summary":{"company":"Acme Books","customer":"Dana Co","amount":"250","currency":"USD","invoice":"1042","balance":"400"}}""",
        ))
        assertEquals("Review QuickBooks payment", view.section)
        assertEquals(listOf("For" to "Acme Books | Dana Co", "Payment" to "$250.00", "Invoice" to "1042 (balance $400.00)"), view.details)
        assertTrue(view.readsBack)
        assertEquals(
            "QuickBooks payment 77 recorded. The invoice balance was reduced.",
            Approvals.decisionMessage(view, true, action = obj("""{"success":true,"result":{"Id":"77"}}""")),
        )
        assertEquals("QuickBooks payment failed: stale token", Approvals.decisionMessage(view, true, action = obj("""{"success":false,"error":"stale token"}""")))
    }

    @Test
    fun inputRequestsAndGeneratedImagesGetCards() {
        val input = TurnCards.classify(TurnArtifact("request_input", obj("""{"type":"input_request","requestId":5,"title":"Site details","fields":[{"key":"site","label":"Site","type":"text"}]}""")))
        assertTrue(input is CardKind.InputRequest && input.requestId == 5)
        assertTrue(TurnCards.classify(TurnArtifact("generate_image", obj("""{"type":"assistant_image","url":"/generated/a.png"}"""))) is CardKind.Image)
        // Only same-origin paths and https: anything else is not loaded.
        assertTrue(TurnCards.classify(TurnArtifact("generate_image", obj("""{"type":"assistant_image","url":"http://x.io/a.png"}"""))) !is CardKind.Image)
    }
}
