package app.oddjob.crew.ui.cards

import app.oddjob.crew.data.CrewJson
import app.oddjob.crew.data.TurnArtifact
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TurnCardsTest {
    private fun artifact(tool: String, json: String) = TurnArtifact(tool, CrewJson.parseToJsonElement(json).jsonObject)

    @Test
    fun newCrewSurfacesGetNativeCards() {
        assertTrue(TurnCards.classify(artifact("gmail_list_messages", """{"type":"google_workspace_results","title":"Inbox","items":[{"id":"1","title":"a"}]}""")) is CardKind.Results)
        assertTrue(TurnCards.classify(artifact("gmail_directive", """{"type":"gmail_directive","sender":"a@b.co"}""")) is CardKind.Directive)
        assertTrue(TurnCards.classify(artifact("publish_work_product", """{"type":"crew_work_product","title":"Plan"}""")) is CardKind.WorkProductNotice)
        assertTrue(TurnCards.classify(artifact("propose_crew_decision", """{"statement":"Go"}""")) is CardKind.Record)
        assertTrue(TurnCards.classify(artifact("request_governance_approval", """{"actionTitle":"Drop"}""")) is CardKind.Governance)
        assertTrue(TurnCards.classify(artifact("render_carousel", """{"type":"assistant_carousel","items":[{"title":"x"}]}""")) is CardKind.CarouselCard)
    }

    @Test
    fun railsOpenOnDesktopAndAnInvalidReviewIsNotDrawn() {
        assertEquals(CardKind.Studio("Decision matrix"), TurnCards.classify(artifact("propose_decision_matrix", """{"candidates":[]}""")))
        assertTrue(TurnCards.classify(artifact("render_gate_review", """{"type":"gate_review","title":"x"}""")) is CardKind.Unsupported)
    }

    @Test
    fun resultListsAreNeverDeduplicated() {
        val a = artifact("gmail_list_messages", """{"type":"google_workspace_results","title":"Inbox","items":[]}""")
        val b = artifact("gmail_list_messages", """{"type":"google_workspace_results","title":"Inbox","items":[{"id":"2","title":"b"}]}""")
        assertEquals(2, TurnCards.dedupe(listOf(a, b)).size)
        val f = artifact("render_form", """{"type":"assistant_form","title":"Same"}""")
        assertEquals(1, TurnCards.dedupe(listOf(f, f.copy())).size)
    }
}
