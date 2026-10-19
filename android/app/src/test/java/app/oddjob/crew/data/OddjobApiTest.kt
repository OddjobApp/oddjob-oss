package app.oddjob.crew.data

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class OddjobApiTest {
    private lateinit var server: MockWebServer
    private lateinit var store: InMemoryStore
    private lateinit var session: SessionStore
    private lateinit var api: OddjobApi

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        store = InMemoryStore()
        session = SessionStore(store)
        api = OddjobApi(session, PersistentCookieJar(store))
    }

    @After
    fun tearDown() = server.shutdown()

    private fun json(body: String, code: Int = 200) =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private fun baseUrl() = server.url("/").toString()

    private suspend fun signIn() {
        server.enqueue(json("""{"id":3,"username":"jann"}""").addHeader("Set-Cookie", "oddjob.sid=s%3Aabc; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax"))
        server.enqueue(json("""{"id":3,"username":"jann","authenticated":true,"csrfToken":"tok"}"""))
        api.login(baseUrl(), "jann", "pw")
        server.takeRequest() // login
        server.takeRequest() // /api/user
    }

    @Test
    fun loginPostsCredentialsAndKeepsTheSessionCookie() = runTest {
        server.enqueue(json("""{"id":3,"username":"jann"}""").addHeader("Set-Cookie", "oddjob.sid=s%3Aabc; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax"))
        server.enqueue(json("""{"id":3,"username":"jann","authenticated":true,"csrfToken":"tok"}"""))

        val user = api.login(baseUrl(), "jann", "pw")

        val login = server.takeRequest()
        assertEquals("/api/login", login.path)
        assertEquals("""{"username":"jann","password":"pw"}""", login.body.readUtf8())
        assertEquals("oddjob.sid=s%3Aabc", server.takeRequest().getHeader("Cookie"))
        assertTrue(user.authenticated)
        assertEquals("jann", session.username)

        // A second process reading the same store still holds the session.
        assertTrue(PersistentCookieJar(store).hasCookie("oddjob.sid"))
    }

    @Test
    fun loginThatDoesNotStickIsAnError() = runTest {
        server.enqueue(json("""{"id":3}"""))
        server.enqueue(json("""{"authenticated":false,"csrfToken":"tok"}"""))
        try {
            api.login(baseUrl(), "jann", "pw")
            fail("expected ApiException")
        } catch (e: ApiException) {
            assertEquals(401, e.status)
        }
    }

    @Test
    fun mutationsCarryCsrfAndRoomOrg() = runTest {
        signIn()
        server.enqueue(json("""{"turns":[],"rounds":1}"""))

        api.sendMessage("crew-1", "hello", agentCardIds = listOf(4, 5), orgId = 7)

        val request = server.takeRequest()
        assertEquals("/api/crew/message", request.path)
        assertEquals("tok", request.getHeader("x-csrf-token"))
        assertEquals("7", request.getHeader("x-organization-id"))
        assertEquals("""{"message":"hello","sessionId":"crew-1","agentCardIds":[4,5]}""", request.body.readUtf8())
    }

    @Test
    fun roomKeysAreEncodedAsOneSegmentAndSinceIsADeltaCursor() = runTest {
        signIn()
        server.enqueue(json("""{"session":null,"turns":[],"delta":false,"cursor":null}"""))
        server.enqueue(json("""{"session":null,"turns":[],"delta":true,"cursor":12}"""))

        api.room("a/b?c", since = null)
        api.room("crew-1", since = 12)

        assertEquals("/api/crew/a%2Fb%3Fc", server.takeRequest().path)
        assertEquals("/api/crew/crew-1?since=12", server.takeRequest().path)
    }

    @Test
    fun getsDoNotSendCsrf() = runTest {
        signIn()
        server.enqueue(json("""{"rooms":[{"sessionKey":"crew-1","title":"Plan","participantCount":2}],"scope":"mine"}"""))
        val rooms = api.rooms()
        assertNull(server.takeRequest().getHeader("x-csrf-token"))
        assertEquals("Plan", rooms.single().title)
    }

    @Test
    fun serverErrorShapesAreUnderstood() = runTest {
        signIn()
        server.enqueue(json("""{"success":false,"error":{"code":"NO_CREW_MEMBERS","message":"No agents in this crew","statusCode":400}}""", 400))
        server.enqueue(json("""{"message":"Authentication required"}""", 401))
        server.enqueue(json("""{"error":"Decision not found"}""", 404))

        val first = runCatching { api.sendMessage("k", "hi", null, null) }.exceptionOrNull() as ApiException
        assertEquals("NO_CREW_MEMBERS", first.code)
        assertEquals("No agents in this crew", first.message)

        val second = runCatching { api.rooms() }.exceptionOrNull() as ApiException
        assertTrue(second.isUnauthorized)
        assertEquals("Authentication required", second.message)

        val third = runCatching { api.updateRecord("k", "decisions", 9, "accepted", null) }.exceptionOrNull() as ApiException
        assertEquals("Decision not found", third.message)
        assertFalse(third.isUnauthorized)
    }

    @Test
    fun logoutForgetsTheCookie() = runTest {
        signIn()
        server.enqueue(json("""{"message":"Logged out successfully"}"""))
        api.logout()
        assertFalse(PersistentCookieJar(store).hasCookie("oddjob.sid"))
        assertNull(session.username)
    }

    @Test
    fun answeringAPausedTaskPostsToConfirmInTheTasksOrg() = runTest {
        signIn()
        server.enqueue(json("""{"task":{"id":"t-1","task":"Book a room","status":"needs_confirmation","organizationId":291,
            "result":{"pending":{"kind":"yield","explanation":"Enter the code we texted","action":"type"},"other":1}},"steps":[]}"""))
        server.enqueue(json("""{"task":{"id":"t-1","task":"Book a room","status":"running","organizationId":291,"result":{}},"steps":[]}"""))

        val paused = api.computerUseTask("t-1", orgId = 291)
        assertTrue(paused.waitingForPerson)
        assertEquals("yield", paused.pending?.kind)
        assertEquals("Enter the code we texted", paused.pending?.explanation)

        val after = api.confirmComputerUseTask("t-1", allow = true, text = " 482913 ", orgId = 291)
        assertEquals("running", after.status)
        assertNull(after.pending)

        val read = server.takeRequest()
        assertEquals("/api/integrations/trycua/computer-use/tasks/t-1", read.path)
        assertEquals("291", read.getHeader("x-organization-id"))
        val confirm = server.takeRequest()
        assertEquals("/api/integrations/trycua/computer-use/tasks/t-1/confirm", confirm.path)
        assertEquals("tok", confirm.getHeader("x-csrf-token"))
        assertEquals("""{"allow":true,"text":"482913"}""", confirm.body.readUtf8())
    }

    @Test
    fun stoppingAPausedTaskSendsNoReply() = runTest {
        signIn()
        server.enqueue(json("""{"task":{"id":"t-1","status":"cancelled"},"steps":[]}"""))
        api.confirmComputerUseTask("t-1", allow = false, text = "", orgId = null)
        val confirm = server.takeRequest()
        assertNull(confirm.getHeader("x-organization-id"))
        assertEquals("""{"allow":false}""", confirm.body.readUtf8())
    }

    @Test
    fun decidingAnApprovalSendsTheCodeAsTheSolution() = runTest {
        signIn()
        server.enqueue(json("""[{"id":9,"status":"pending","stepName":"Sign in","modifiedOutput":{"type":"verification_code"}}]"""))
        server.enqueue(json("""{"message":"Decision recorded"}"""))
        server.enqueue(json("""{"message":"Forbidden"}""", 403))

        val inbox = api.approvals()
        assertEquals(ApprovalInput.Code, inbox.single().input)
        assertEquals(DecisionOutcome.Recorded("approved", null), api.decideApproval(9, approved = true, code = " 123456 "))
        assertTrue(api.decideApproval(9, approved = false) is DecisionOutcome.Failed)

        assertEquals("/api/approvals", server.takeRequest().path)
        val approve = server.takeRequest()
        assertEquals("/api/approvals/9/decision", approve.path)
        assertEquals("tok", approve.getHeader("x-csrf-token"))
        assertEquals("""{"decision":"approved","modifiedOutput":{"solution":"123456"}}""", approve.body.readUtf8())
        assertEquals("""{"decision":"rejected"}""", server.takeRequest().body.readUtf8())
    }

    @Test
    fun serverUrlIsNormalised() {
        assertEquals("https://oddjob.example", SessionStore.normalizeServerUrl(" oddjob.example/ "))
        assertEquals("http://10.0.2.2:5000", SessionStore.normalizeServerUrl("http://10.0.2.2:5000/"))
    }

    @Test
    fun filesUploadAsMultipartWithTheirNamesAndTheCsrfToken() = runTest {
        signIn()
        server.enqueue(json("""{"attachments":[{"id":4,"displayName":"site.jpg","mimeType":"image/jpeg","byteSize":3,"parseStatus":"parsed","parseType":"image"}]}""", 201))

        val list = api.uploadAttachments(
            "crew-1-a",
            listOf(UploadFile("site.jpg", "image/jpeg", byteArrayOf(1, 2, 3)), UploadFile("notes.pdf", "application/pdf", byteArrayOf(4))),
            orgId = 342,
        )

        val upload = server.takeRequest()
        assertEquals("POST", upload.method)
        assertEquals("/api/crew/crew-1-a/attachments", upload.path)
        assertEquals("tok", upload.getHeader("x-csrf-token"))
        assertEquals("342", upload.getHeader("x-organization-id"))
        assertTrue(upload.getHeader("Content-Type")!!.startsWith("multipart/form-data"))
        val body = upload.body.readUtf8()
        assertTrue(body.contains("""name="files"; filename="site.jpg""""))
        assertTrue(body.contains("""name="files"; filename="notes.pdf""""))
        assertTrue(body.contains("Content-Type: application/pdf"))
        assertEquals(listOf("site.jpg"), list.attachments.map { it.displayName })
        assertTrue(list.attachments[0].readable)
    }
}
