package app.oddjob.crew.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ApprovalsTest {
    private fun obj(json: String): JsonObject = CrewJson.parseToJsonElement(json).jsonObject

    @Test
    fun aCrewProposalCardIsDecidableByItsProposalId() {
        val view = Approvals.fromCard(obj("""{"type":"approval_request","kind":"scenario_simulation","proposalId":42,
            "title":"Monte Carlo Simulation: \"churn\"","reason":"Check the downside","status":"pending","requestedBy":"analyst"}"""))
        assertEquals(42, view.id)
        assertEquals("scenario_simulation", view.kind)
        assertEquals("Check the downside", view.reason)
        assertEquals(ApprovalInput.None, view.input)
        assertTrue(view.pending)
    }

    @Test
    fun aTimestampIdIsAProposalThatWasNeverSaved() {
        val view = Approvals.fromCard(obj("""{"type":"approval_request","kind":"cycle_draft","proposalId":1791100000000,"title":"Draft"}"""))
        assertNull(view.id)
        assertTrue(view.unpersisted)
    }

    @Test
    fun anOutboundMessageShowsWhatWouldBeSent() {
        val view = Approvals.fromCard(obj("""{"type":"approval_request","kind":"outbound_message","proposalId":7,"channel":"email",
            "to":["dana@northwind.io","ops@northwind.io"],"subject":"Three infra roles","body":"Hi Dana","sensitivity":"external_first_contact"}"""))
        assertEquals(
            listOf("Channel" to "Email", "To" to "dana@northwind.io, ops@northwind.io", "Subject" to "Three infra roles", "Sensitivity" to "external first contact"),
            view.details,
        )
        assertEquals("Hi Dana", view.body)
    }

    @Test
    fun challengesAskForACodeOrGoToTheWeb() {
        val otp = Approvals.fromCard(obj("""{"type":"approval_request","proposalId":3,"context":{"type":"2fa","goal":"sign in"}}"""))
        assertEquals(ApprovalInput.Code, otp.input)
        assertEquals("Two-Factor Authentication / Security Code", otp.title)

        val captcha = Approvals.fromCard(obj("""{"type":"captcha_solution","proposalId":4}"""))
        assertTrue(captcha.input is ApprovalInput.WebOnly)
        assertEquals("captcha_solution", captcha.kind)
    }

    @Test
    fun anInboxRowReadsItsEnvelopeFromToolArgsWhenNothingWasModified() {
        val view = Approvals.fromInbox(obj("""{"id":91,"status":"pending","stepName":"Run send_email","comments":"from the room",
            "modifiedOutput":null,"toolArgs":{"type":"approval_request","kind":"outbound_message","to":"a@b.co","body":"Hello"}}"""))
        assertEquals(91, view.id)
        assertEquals("Run send_email", view.title)
        assertEquals("from the room", view.reason)
        assertEquals("Hello", view.body)
    }

    @Test
    fun aFormStageIsFilledInOnTheWeb() {
        val view = Approvals.fromInbox(obj("""{"id":5,"status":"pending","modifiedOutput":{"kind":"form_stage"}}"""))
        assertTrue(view.input is ApprovalInput.WebOnly)
    }

    @Test
    fun decisionLinesMatchTheWebCardWordForWord() {
        val view = Approvals.fromCard(obj("""{"type":"approval_request","proposalId":42,"title":"Deploy"}"""))
        assertEquals("I approved proposal #42 (\"Deploy\").", Approvals.decisionMessage(view, true))
        assertEquals("I rejected proposal #42 (\"Deploy\").", Approvals.decisionMessage(view, false))
        assertEquals(
            "I approved proposal #42 (\"Deploy\"). Scaffolded crm from base, auth.",
            Approvals.decisionMessage(view, true, obj("""{"success":true,"appName":"crm","executedPacks":["base","auth"]}""")),
        )
        assertEquals("approved", Approvals.decidedInRoom(view, listOf("thanks", "I approved proposal #42 (\"Deploy\").")))
        assertNull(Approvals.decidedInRoom(view, listOf("I approved proposal #420 (\"Other\").")))
    }

    @Test
    fun aRequestResolvedEarlierIsNotReportedAsYourDecision() {
        assertEquals(
            DecisionOutcome.AlreadyDecided("rejected"),
            decisionOutcome(obj("""{"status":"rejected","message":"This request has already been resolved."}"""), approved = true),
        )
        assertEquals(DecisionOutcome.Recorded("approved", null), decisionOutcome(obj("""{"message":"Decision recorded"}"""), approved = true))
        assertEquals(
            DecisionOutcome.Failed("You are not the designated approver for this request."),
            decisionFailure(ApiException(403, null, "Forbidden")),
        )
    }
}
