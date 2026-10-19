package app.oddjob.crew.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same cases as stage-confirmation-display.test.ts, so web and Android read alike. */
class TurnDisplayTest {
    @Test
    fun stagesReadAsWhatHappened() {
        assertEquals(
            "Confirmed architecture with 2 selected packs.",
            TurnDisplay.summary("""I confirmed stage "stage-intake" with configuration: {"selectedPacks":["a","b"],"_trace":{"x":1}}"""),
        )
        assertEquals("Completed architecture with 1 selected pack.", TurnDisplay.summary("""I completed stage "build" with configuration: {"selectedPackIds":["a"]}"""))
        assertEquals("Completed stage configuration.", TurnDisplay.summary("""I completed stage "review" with configuration: {"ok":true}"""))
    }

    @Test
    fun aFormSubmissionShowsItsFieldsNeverItsJson() {
        val shown = TurnDisplay.summary(
            """I submitted the "New customer" form with: {"display_name":"Acme Ltd","email":"ap@acme.io","tags":["vip","net30"],"address":{"city":"X"},"_trace":"t"}""",
        )
        assertEquals("Submitted “New customer”: Display name: Acme Ltd · Email: ap@acme.io · Tags: vip, net30", shown)
        assertFalse(shown!!.contains("{"))
    }

    @Test
    fun theDraftVariantMayHaveAnInstructionAfterTheJson() {
        val message = """I submitted the "Email draft" with: {"to":"dana@northwind.io","subject":"Hi {there}","body":"x","body_format":"markdown"}. Prepare the proposed action for my review; do not send without approval."""
        assertEquals("Submitted “Email draft”: To: dana@northwind.io · Subject: Hi {there} · Body: x", TurnDisplay.summary(message))
    }

    @Test
    fun longValuesAndManyFieldsAreCapped() {
        val shown = TurnDisplay.summary("""I submitted the "Big" form with: {"a":"${"x".repeat(100)}","b":1,"c":2,"d":3,"e":4,"f":5}""")!!
        assertTrue(shown.contains("A: " + "x".repeat(59) + "…"))
        assertTrue(shown.endsWith("+2 more"))
    }

    @Test
    fun aPlaybookIntakeShowsItsLabelAndDirection() {
        val message = "[DIVERSE PRIMITIVE INTAKE: CUSTOMER ONBOARDING]\n• Direction (D): Onboard Acme with SSO\n• Intent (I): x\n• Variables & Inputs (V): {\"a\":1}"
        assertEquals("Started Customer onboarding setup: Onboard Acme with SSO", TurnDisplay.summary(message))
    }

    @Test
    fun ordinaryMessagesAndBrokenJsonAreLeftAlone() {
        assertNull(TurnDisplay.summary("""Please explain {"inputs": "data"}"""))
        assertNull(TurnDisplay.summary("""I submitted the "X" form with: {nope"""))
        assertNull(TurnDisplay.summary("""I confirmed stage "intake" with configuration: {broken"""))
    }
}
