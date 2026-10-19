package app.oddjob.crew.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ApprovalKindsTest {
    private fun obj(json: String): JsonObject = CrewJson.parseToJsonElement(json).jsonObject

    @Test
    fun argsReadAsLabelledFieldsNotJson() {
        assertEquals(
            listOf(
                "Summary" to "Design review",
                "Attendees" to "a@x.io, b@x.io",
                "Start" to "Date time: 2026-10-09T10:00",
            ),
            ApprovalArgs.fields(obj("""{"summary":"Design review","attendees":[{"email":"a@x.io"},{"email":"b@x.io"}],"start":{"dateTime":"2026-10-09T10:00"},"reviewed_raw":"x"}""")),
        )
        assertEquals("Body text", ApprovalArgs.fields(obj(
            """{"reviewed_message":{"payload":{"headers":[{"name":"To","value":"c@d.io"}],"mimeType":"text/plain","decodedText":"Body text"}}}""",
        )).last().second)
        assertEquals("Max total", ApprovalArgs.humanize("maxTotal"))
    }

    @Test
    fun googleAndCalendarProposalsShowTheirArgs() {
        val view = Approvals.fromCard(obj(
            """{"type":"approval_request","kind":"calendar_action","proposalId":8,"title":"Move standup",
                "args":{"event_id":"e1","start":"2026-10-09T10:00"}}""",
        ))
        assertEquals("Review calendar change", view.section)
        assertEquals(listOf("Event id" to "e1", "Start" to "2026-10-09T10:00"), view.details)
        assertTrue(view.readsBack)
        assertEquals("Approve", view.approveLabel)
    }

    @Test
    fun anAmazonHandoffHidesTheCartUrlAndOnlyLinksToAmazon() {
        val view = Approvals.fromCard(obj(
            """{"type":"approval_request","kind":"amazon_purchase","proposalId":9,"title":"Desk lamp",
                "args":{"asin":"B01","cart_url":"https://www.amazon.com/cart"}}""",
        ))
        assertEquals(listOf("Asin" to "B01"), view.details)
        assertEquals(
            "Open cart on Amazon" to "https://www.amazon.com/gp/cart",
            Approvals.handoffLink(view, obj("""{"success":true,"result":{"checkoutUrl":"https://www.amazon.com/gp/cart"}}""")),
        )
        assertNull(Approvals.handoffLink(view, obj("""{"success":true,"result":{"checkoutUrl":"https://amaz0n.co/cart"}}""")))
        assertNull(Approvals.handoffLink(view, obj("""{"success":false,"result":{"checkoutUrl":"https://www.amazon.com/gp/cart"}}""")))
    }

    @Test
    fun aFlightHubBookingNamesAnUnverifiedCurrency() {
        val view = Approvals.fromCard(obj(
            """{"type":"approval_request","kind":"flighthub_booking","proposalId":10,"title":"YUL-CDG",
                "args":{"itinerary":"YUL → CDG, Oct 20","priceDisplay":"$812"}}""",
        ))
        assertEquals(listOf("Itinerary" to "YUL → CDG, Oct 20", "Price" to "$812 (currency unverified)"), view.details)
    }

    @Test
    fun anOutboundMessageReadsAsTheMessageAndPostsTheWebsLines() {
        val view = Approvals.fromCard(obj(
            """{"type":"approval_request","kind":"outbound_message","proposalId":7,"channel":"email",
                "to":["dana@northwind.io"],"subject":"Roles","body":"Hi Dana"}""",
        ))
        assertEquals("New email", view.heading)
        assertEquals("Send email", view.approveLabel)
        assertEquals("Discard", view.rejectLabel)
        assertEquals("Ready to send", view.statusLabel("pending"))
        assertEquals("Send failed", view.statusLabel("approved", sendFailed = true))
        assertEquals("I sent the email message to dana@northwind.io.", Approvals.decisionMessage(view, true))
        assertEquals("I discarded the email message draft to dana@northwind.io.", Approvals.decisionMessage(view, false))
        assertEquals(
            "I approved sending the email message to dana@northwind.io, but delivery failed: bounced.",
            Approvals.decisionMessage(view, true, outbound = obj("""{"sent":false,"error":"bounced"}""")),
        )
    }

    @Test
    fun toolProposalsPostTheirResult() {
        val view = Approvals.fromCard(obj("""{"type":"approval_request","kind":"google_workspace_action","proposalId":11,"title":"Create doc"}"""))
        assertEquals(
            "Google Workspace change applied: Create doc. Result: Document id: d9",
            Approvals.decisionMessage(view, true, action = obj("""{"success":true,"result":{"documentId":"d9"}}""")),
        )
        assertEquals(
            "Google Workspace change failed: quota",
            Approvals.decisionMessage(view, true, action = obj("""{"success":false,"error":"quota"}""")),
        )
    }

    @Test
    fun theDecisionResponseCarriesToolAndSendResults() {
        val outcome = decisionOutcome(obj("""{"calendarAction":{"success":true},"outboundMessage":{"sent":true}}"""), approved = true)
        outcome as DecisionOutcome.Recorded
        assertEquals("true", outcome.action?.get("success").toString())
        assertEquals("true", outcome.outbound?.get("sent").toString())
    }

    @Test
    fun aStoredRowSaysWhatHappenedAfterTheTurn() {
        val back = Approvals.readBack(obj(
            """{"id":7,"status":"approved","toolArgs":{"kind":"outbound_message","body":"orig"},
                "modifiedOutput":{"kind":"outbound_message","body":"edited","subject":"S","sendResult":{"sent":false,"error":"x"}}}""",
        ))
        assertEquals("approved", back.status)
        assertEquals("edited", back.body)
        assertEquals("S", back.subject)
        assertEquals("false", back.sendResult?.get("sent").toString())
    }

    @Test
    fun aQuickBooksVoidWaitsForAnExecutiveAndItsProposerGetsNoButtons() {
        val view = Approvals.fromCard(obj(
            """{"type":"approval_request","kind":"quickbooks_action","actionName":"quickbooks_void_invoice","proposalId":7,"title":"Void invoice 1001","status":"pending","needsExecutiveApproval":true,"proposedBy":"u-ar","summary":{"invoice":"1001"}}""",
        ))
        assertTrue(view.note!!.contains("Needs an Executive's approval"))
        assertTrue(view.awaitsAnotherApprover("u-ar"))
        assertEquals(false, view.awaitsAnotherApprover("u-exec"))
        val invoice = Approvals.fromCard(obj(
            """{"type":"approval_request","kind":"quickbooks_action","actionName":"quickbooks_create_invoice","proposalId":8,"title":"Invoice","status":"pending","proposedBy":"u-ar"}""",
        ))
        assertEquals(false, invoice.awaitsAnotherApprover("u-ar"))
    }
}
