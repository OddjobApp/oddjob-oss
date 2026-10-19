package app.oddjob.crew.ui.room

import app.oddjob.crew.data.CrewAttachment
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AttachmentsTest {
    @Test
    fun filesOverTheServersLimitAreRefusedBeforeUploading() {
        val limit = 25L * 1024 * 1024
        assertNull(rejectReason("site.jpg", limit, limit))
        assertEquals("video.mp4 is larger than 25 MB.", rejectReason("video.mp4", limit + 1, limit))
    }

    @Test
    fun theBarSaysWhatHappenedToEachFile() {
        assertEquals("ready", statusLabel(CrewAttachment(1, parseStatus = "parsed", indexStatus = "indexed")))
        assertEquals("reading…", statusLabel(CrewAttachment(1, parseStatus = "parsed", indexStatus = "pending")))
        assertEquals("couldn't read (failed)", statusLabel(CrewAttachment(1, parseStatus = "failed")))
        assertEquals("3.4 MB", readableSize(3_565_158))
        assertEquals("12 KB", readableSize(12_000))
    }
}
