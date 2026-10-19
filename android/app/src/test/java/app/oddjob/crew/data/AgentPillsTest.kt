package app.oddjob.crew.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentPillsTest {
    private fun card(id: Int, name: String, tools: List<String> = emptyList(), persona: String? = null, caps: List<String> = emptyList()) =
        AgentCard(id = id, name = name, personaType = persona, tools = tools, capabilities = caps)

    // Shapes taken from the dev org's real cards.
    private val copilot = card(174, "Copilot", listOf("render_app_surface", "mount_builder_pod"), "copilot")
    private val analyst = card(210, "Analyst", persona = "analyst", caps = listOf("data analysis", "pattern recognition"))
    private val ghost = card(225, "GhostWriter", listOf("scribe_update_node", "scribe_get_document"))
    private val producer = card(334, "Producer", listOf("propose_decision_matrix", "mount_media_studio"))
    private val auditor = card(203, "Security Auditor", persona = "security")
    private val all = listOf(copilot, analyst, ghost, producer, auditor)

    @Test
    fun studioAgentsAreRecognisedByTheirTools() {
        assertTrue(AgentPills.isStudioAgent(ghost))
        assertTrue(AgentPills.isStudioAgent(producer))
        assertFalse("mount_builder_pod is not a studio", AgentPills.isStudioAgent(copilot))
        assertFalse(AgentPills.isStudioAgent(analyst))
    }

    @Test
    fun detectionNeedsAnAtAndThreeMatchingCharacters() {
        assertNull(AgentPills.detect("@an", 2, all))
        assertEquals(AgentPills.Mention("ana", 0), AgentPills.detect("@ana", 4, all))
        assertEquals(AgentPills.Mention("sec", 6), AgentPills.detect("hello @sec", 10, all))
        assertNull("email addresses are not mentions", AgentPills.detect("me@ana", 6, all))
        assertNull("no agent matches", AgentPills.detect("@zzz", 4, all))
        assertNull("caret before the @", AgentPills.detect("@ana", 0, all))
        // Capabilities and persona match too, as on the web.
        assertEquals("pat", AgentPills.detect("@pat", 4, all)?.query)
    }

    @Test
    fun matchesPutNamePrefixesFirst() {
        val agents = listOf(card(1, "Zeta Analyst"), card(2, "Analyst"), card(3, "Analytics Bot"))
        val names = AgentPills.matches(AgentPills.Mention("ana", 0), agents).map { it.name }
        assertEquals(listOf("Analyst", "Analytics Bot", "Zeta Analyst"), names)
    }

    @Test
    fun insertReplacesTheQueryAndPlacesTheCaret() {
        val (text, caret) = AgentPills.insert("ask @ana   about it", AgentPills.Mention("ana", 4), analyst)
        assertEquals("ask @Analyst about it", text)
        assertEquals("ask @Analyst ".length, caret)
    }

    @Test
    fun splitFindsKnownNamesAtWordBoundaries() {
        val names = listOf("Analyst", "Security Auditor", "Security")
        val parts = AgentPills.split("(@Security Auditor) and @Analyst, not me@Analyst or @Analysts", names)
        assertEquals(
            listOf(
                AgentPills.Part.Text("("),
                AgentPills.Part.Pill("Security Auditor"),
                AgentPills.Part.Text(") and "),
                AgentPills.Part.Pill("Analyst"),
                AgentPills.Part.Text(", not me@Analyst or @Analysts"),
            ),
            parts,
        )
        assertEquals(listOf(AgentPills.Part.Text("no mentions")), AgentPills.split("no mentions", names))
    }

    @Test
    fun accentsMatchTheWebHash() {
        // Computed with crew-style-helpers.ts accentFor's hash.
        val expected = mapOf(
            "Copilot" to 2, "Analyst" to 4, "Security Auditor" to 2, "Site Reliability Engineer" to 2,
            "GhostWriter" to 2, "Media Creator" to 2, "Automated Service Dispatch Bot" to 0, "x" to 0,
        )
        expected.forEach { (name, index) -> assertEquals(name, index, AgentPills.accentIndex(name)) }
    }

    @Test
    fun hatsFollowTheWebRules() {
        val cases = mapOf(
            ("Copilot" to "copilot") to AgentPills.Hat.Bowler,
            ("AI Trainer" to "general") to AgentPills.Hat.Cowboy,
            ("Security Vulnerability & Compliance Auditor" to "general") to AgentPills.Hat.Deerstalker,
            ("Knowledge Architect" to "knowledge-architect") to AgentPills.Hat.Mortarboard,
            ("Creative Director" to "creative-director") to AgentPills.Hat.Beret,
            ("Site Reliability Engineer" to "devops") to AgentPills.Hat.HardHat,
            ("Finance Analyst" to "general") to AgentPills.Hat.Fedora,
            ("Service Dispatch Coordinator" to "general") to AgentPills.Hat.FlatCap,
            ("Producer" to "producer") to AgentPills.Hat.TopHat,
        )
        for ((agent, hat) in cases) assertEquals(agent.first, hat, AgentPills.hatFor(agent.first, agent.second))
    }

    @Test
    fun unmatchedNamesWearTheSameHatAsOnTheWeb() {
        // Expected values computed by hatFor in CrewAgentHat.tsx. "Three" and
        // "Luxury Concierge" also prove `hr` and `ux` match whole words only.
        val web = mapOf(
            "Zed" to AgentPills.Hat.Bowler,
            "Three" to AgentPills.Hat.HardHat,
            "Luxury Concierge" to AgentPills.Hat.HardHat,
            "HR Partner" to AgentPills.Hat.FlatCap,
            "QR Provisioner" to AgentPills.Hat.Mortarboard,
            "action_item_template Form Agent" to AgentPills.Hat.TopHat,
        )
        for ((name, hat) in web) assertEquals(name, hat, AgentPills.hatFor(name))
    }
}
