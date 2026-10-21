package app.oddjob.crew.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A build with a fixed server keeps only a sign-in made against that server. */
class SessionStoreTest {
    private fun signedIn(server: String?) = SessionStore(InMemoryStore()).apply {
        serverUrl = server
        username = "jann"
    }

    @Test
    fun forgetsASignInSavedAgainstAnotherServer() {
        val session = signedIn("https://d2y3wwndfqedcn.cloudfront.net")
        assertTrue(session.forgetOtherServer("https://oddjob.app"))
        assertNull(session.serverUrl)
        assertNull(session.username)
    }

    @Test
    fun keepsASignInOnTheFixedServer() {
        // Saved with a trailing slash and no scheme: the same server once normalized.
        val session = signedIn("oddjob.app/")
        assertFalse(session.forgetOtherServer("https://oddjob.app"))
        assertEquals("https://oddjob.app", session.serverUrl)
        assertEquals("jann", session.username)
    }

    @Test
    fun leavesAFreshInstallAlone() {
        val session = SessionStore(InMemoryStore())
        assertFalse(session.forgetOtherServer("https://oddjob.app"))
        assertNull(session.serverUrl)
    }
}
