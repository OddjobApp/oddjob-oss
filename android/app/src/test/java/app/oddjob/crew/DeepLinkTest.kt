package app.oddjob.crew

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeepLinkTest {
    @Test
    fun roomPathsOpenTheRoomEverythingElseIsNotARoom() {
        assertEquals("crew-1-abc", roomKeyFromPath("/workspace/chat/crew-1-abc"))
        assertEquals("crew-1-abc", roomKeyFromPath("/workspace/chat/crew-1-abc?orgId=7"))
        assertNull(roomKeyFromPath("/workspace/chat/"))
        assertNull(roomKeyFromPath("/assistant/workbench"))
        assertNull(roomKeyFromPath("/missions/12"))
    }

    @Test
    fun gmailAlertPushesCarryTheirEventIntoTheRoom() {
        assertEquals("crew-1-abc", roomKeyFromPath("/workspace/chat/crew-1-abc?gmailAlert=55"))
        assertEquals(55, gmailAlertFromPath("/workspace/chat/crew-1-abc?gmailAlert=55"))
        assertEquals(null, gmailAlertFromPath("/workspace/chat/crew-1-abc"))
        assertEquals(null, gmailAlertFromPath("/workspace/chat/crew-1-abc?gmailAlert=0"))
        assertEquals(null, gmailAlertFromPath("/assistant/workbench?gmailAlert=55"))
    }

    @Test
    fun pausePushesOpenTheTaskInItsOrg() {
        assertEquals(
            ComputerUseLink("3f2b-uuid", 291),
            computerUseLinkFromPath("/workspace/computer-use?session=sess%201&task=3f2b-uuid&orgId=291"),
        )
        // Pushes sent before the org was added still open the task.
        assertEquals(ComputerUseLink("t-1", null), computerUseLinkFromPath("/workspace/computer-use?session=s&task=t-1"))
        assertNull(computerUseLinkFromPath("/workspace/computer-use?session=s"))
        assertNull(computerUseLinkFromPath("/workspace/computer-use-other?task=t-1"))
        assertNull(computerUseLinkFromPath("/workspace/chat/crew-1"))
    }

    @Test
    fun approvalPushesOpenTheInboxOnThatApproval() {
        assertEquals(ApprovalsLink(41), approvalsLinkFromPath("/assistant/workbench?approval=41"))
        // Pushes from before the id was added still open the inbox.
        assertEquals(ApprovalsLink(null), approvalsLinkFromPath("/assistant/workbench"))
        assertNull(approvalsLinkFromPath("/assistant/workbench-other"))
    }
}
