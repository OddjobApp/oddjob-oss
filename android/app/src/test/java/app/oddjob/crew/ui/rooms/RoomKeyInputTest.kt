package app.oddjob.crew.ui.rooms

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RoomKeyInputTest {
    @Test
    fun acceptsBareKeysAndSharedLinks() {
        assertEquals("crew-1-abc", roomKeyFromInput("  crew-1-abc "))
        assertEquals("crew-1-abc", roomKeyFromInput("https://oddjob.example/workspace/chat/crew-1-abc?orgId=7"))
        assertEquals("crew-1-abc", roomKeyFromInput("http://10.0.2.2:5000/workspace/chat/crew-1-abc/"))
    }

    @Test
    fun aLinkOrNotificationPathNamesTheRoomsOrg() {
        assertEquals(342, roomOrgIdFromPath("/workspace/chat/crew-1?orgId=342"))
        assertEquals(7, roomOrgIdFromPath("https://oddjob.example/workspace/chat/crew-1-abc?gmailAlert=3&orgId=7#t"))
        assertNull(roomOrgIdFromPath("crew-1-abc"))
        assertNull(roomOrgIdFromPath("/workspace/chat/crew-1?orgId=-2"))
        assertNull(roomOrgIdFromPath("/workspace/chat/crew-1?xorgId=5"))
    }
}
