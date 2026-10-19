package app.oddjob.crew.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class RoomStateTest {
    private fun turn(id: Int, content: String = "t$id", speaker: String = "agent") =
        CrewTurn(id = id, speakerType = speaker, speakerName = "A", content = content)

    private val session = CrewSession(id = 1, organizationId = 7, sessionKey = "crew-1")

    @Test
    fun fullReadReplacesAndSetsCursorToLastTurn() {
        val state = RoomState(turns = listOf(turn(99))).apply(
            RoomResponse(session = session, turns = listOf(turn(3), turn(1), turn(2)), cursor = 3),
        )
        assertEquals(listOf(1, 2, 3), state.turns.map { it.id })
        assertEquals(3, state.cursor)
        assertEquals(7, state.orgId)
    }

    @Test
    fun deltaMergesWithoutDuplicatingAndLaterCopyWins() {
        val start = RoomState(session = session, turns = listOf(turn(1), turn(2, "streamed")), cursor = 2)
        val next = start.apply(
            RoomResponse(session = session, turns = listOf(turn(2, "fetched"), turn(3)), delta = true, cursor = 3),
        )
        assertEquals(listOf(1, 2, 3), next.turns.map { it.id })
        assertEquals("fetched", next.turns[1].content)
        assertEquals(3, next.cursor)
    }

    @Test
    fun emptyDeltaNeverRewindsTheCursor() {
        val start = RoomState(session = session, turns = listOf(turn(5)), cursor = 5)
        // The server answers an empty delta with cursor = since; a null must not reset it either.
        val next = start.apply(RoomResponse(session = session, delta = true, cursor = null))
        assertEquals(5, next.cursor)
        assertEquals(listOf(5), next.turns.map { it.id })
    }

    @Test
    fun deltaKeepsMembersWhenItCarriesNone() {
        val members = listOf(AgentCard(1, "Analyst"))
        val start = RoomState(session = session, members = members)
        assertEquals(members, start.apply(RoomResponse(session = session, delta = true)).members)
        // A full read with no members means the room genuinely has none.
        assertTrue(start.apply(RoomResponse(session = session, delta = false)).members.isEmpty())
    }

    @Test
    fun deltaRecordsMergeNewestFirst() {
        val start = RoomState(session = session, decisions = listOf(Decision(1, "a")))
        val next = start.apply(
            RoomResponse(session = session, delta = true, decisions = listOf(Decision(2, "b"), Decision(1, "a", status = "accepted"))),
        )
        assertEquals(listOf(2, 1), next.decisions.map { it.id })
        assertEquals("accepted", next.decisions[1].status)
    }

    @Test
    fun appendTurnAdvancesCursorAndIsIdempotent() {
        val state = RoomState().appendTurn(turn(4)).appendTurn(turn(4))
        assertEquals(1, state.turns.size)
        assertEquals(4, state.cursor)
    }

    @Test
    fun missingRoomHasNoOrg() {
        assertNull(RoomState().apply(RoomResponse(session = null)).orgId)
    }

    @Test
    fun roomKeyMatchesTheWebFormat() {
        val key = newRoomKey(now = 1700000000000, random = Random(1))
        assertTrue(key, Regex("^crew-1700000000000-[0-9a-z]{7}$").matches(key))
    }
}
