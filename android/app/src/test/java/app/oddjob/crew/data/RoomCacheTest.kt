package app.oddjob.crew.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class RoomCacheTest {
    @get:Rule val tmp = TemporaryFolder()

    private var who: String? = RoomCache.ownerOf("http://10.0.2.2:5000", "admin2")
    private fun cache() = RoomCache(tmp.root) { who }

    private fun turn(id: Int) = CrewTurn(id = id, speakerType = "agent", speakerName = "Copilot", content = "turn $id")
    private val session = CrewSession(id = 1, organizationId = 473, sessionKey = "crew-1-a", title = "Map room")
    private fun room(vararg ids: Int) = RoomState(session = session, turns = ids.map(::turn), cursor = ids.maxOrNull() ?: 0, currentUserId = "u1")

    @Test
    fun aSavedRoomComesBackAsItWas() {
        cache().saveRoom("crew-1-a", room(1, 2, 3))
        val back = cache().loadRoom("crew-1-a")!!
        assertEquals(listOf(1, 2, 3), back.turns.map { it.id })
        assertEquals("Map room", back.session?.title)
        assertEquals(3, back.cursor)
        assertEquals("u1", back.currentUserId)
    }

    @Test
    fun anotherAccountOrServerNeverSeesIt() {
        cache().saveRoom("crew-1-a", room(1))
        cache().saveRooms(listOf(RoomSummary(sessionKey = "crew-1-a")))
        who = RoomCache.ownerOf("http://10.0.2.2:5000", "agent99")
        assertNull(cache().loadRoom("crew-1-a"))
        assertNull(cache().loadRooms())
        who = RoomCache.ownerOf("https://prod.oddjob.app", "admin2")
        assertNull(cache().loadRoom("crew-1-a"))
        who = null // signed out
        assertNull(cache().loadRoom("crew-1-a"))
    }

    @Test
    fun longRoomsKeepTheirLatestTurnsAndACursorThatMatches() {
        val ids = (1..(RoomCache.MAX_TURNS + 50)).toList().toIntArray()
        cache().saveRoom("crew-1-a", room(*ids))
        val back = cache().loadRoom("crew-1-a")!!
        assertEquals(RoomCache.MAX_TURNS, back.turns.size)
        assertEquals(51, back.turns.first().id)
        assertEquals(ids.last(), back.cursor)
    }

    @Test
    fun onlyTheMostRecentRoomsAreKeptAndTheListSurvives() {
        cache().saveRooms(listOf(RoomSummary(sessionKey = "k")))
        (1..RoomCache.MAX_ROOMS + 5).forEach { n ->
            cache().saveRoom("crew-$n", room(n))
            tmp.root.listFiles()!!.forEach { if (it.lastModified() == 0L) it.setLastModified(1) }
            Thread.sleep(2)
        }
        val roomFiles = tmp.root.listFiles()!!.count { it.name.endsWith(".json") }
        assertEquals(RoomCache.MAX_ROOMS + 1, roomFiles) // + the rooms list
        assertEquals(1, cache().loadRooms()!!.size)
    }

    @Test
    fun aDraftRoomIsNotSavedAndACorruptFileIsDropped() {
        cache().saveRoom("draft", RoomState(turns = listOf(turn(1))))
        assertNull(cache().loadRoom("draft"))

        cache().saveRoom("crew-1-a", room(1))
        tmp.root.listFiles()!!.first { it.name.endsWith(".json") }.writeText("{not json")
        assertNull(cache().loadRoom("crew-1-a"))
    }

    @Test
    fun signOutLeavesNothing() {
        cache().saveRoom("crew-1-a", room(1))
        cache().saveRooms(listOf(RoomSummary(sessionKey = "crew-1-a")))
        cache().clear()
        assertEquals(0, tmp.root.listFiles()!!.size)
    }
}
