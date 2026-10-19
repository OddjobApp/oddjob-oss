package app.oddjob.crew.data

import org.junit.Assert.assertEquals
import org.junit.Test

class AgentSelectionTest {
    private fun card(id: Int, name: String = "Agent $id", tools: List<String> = emptyList()) = AgentCard(id = id, name = name, tools = tools)
    private fun room(members: List<AgentCard>, saved: Map<String, List<Int>> = emptyMap()) = RoomState(
        session = CrewSession(id = 1, organizationId = 7, sessionKey = "crew-1", memory = RoomMemory(activeAgentSelections = saved)),
        members = members,
        currentUserId = "u1",
    )

    @Test
    fun aChoiceMadeHereWinsThenTheSavedOneThenTheRoster() {
        val r = room(listOf(card(1), card(2)), saved = mapOf("u1" to listOf(2, 9), "u2" to listOf(1)))
        assertEquals(listOf(3), AgentSelection.resolve(listOf(3), r, null))
        // Saved for this person only; an agent the org no longer offers is dropped.
        assertEquals(listOf(2), AgentSelection.resolve(null, r, listOf(card(1), card(2), card(3))))
        assertEquals(listOf(2, 9), AgentSelection.resolve(null, r, null)) // org list not loaded yet
        assertEquals(listOf(1, 2), AgentSelection.resolve(null, room(listOf(card(1), card(2))), null))
    }

    @Test
    fun anEmptySavedChoiceIsAChoice() {
        // Deselecting everyone is kept, not replaced by the roster.
        assertEquals(emptyList<Int>(), AgentSelection.resolve(null, room(listOf(card(1)), saved = mapOf("u1" to emptyList())), null))
    }

    @Test
    fun toggleSelectsAndDeselects() {
        assertEquals(listOf(1), AgentSelection.toggle(listOf(1, 2), 2))
        assertEquals(listOf(1, 2, 3), AgentSelection.toggle(listOf(1, 2), 3))
    }

    @Test
    fun theSheetListsTheRosterAndAddedAgentsButNoStudioAgents() {
        val studio = card(5, "Media Studio", tools = listOf("mount_media_studio"))
        val r = room(listOf(card(1), studio))
        val pool = AgentSelection.pool(r, listOf(card(1), card(2), card(3)), selected = listOf(1, 2))
        assertEquals(listOf(1, 2), pool.map { it.id })
    }
}
