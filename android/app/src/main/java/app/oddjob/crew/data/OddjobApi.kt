package app.oddjob.crew.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.IOException
import java.util.concurrent.TimeUnit

/** A non-2xx answer, carrying the server's own error code when it sent one. */
class ApiException(val status: Int, val code: String?, message: String) : IOException(message) {
    val isUnauthorized get() = status == 401
}

val CrewJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
    explicitNulls = false
    coerceInputValues = true
}

/**
 * The CREW surface of the Oddjob server.
 *
 * Authentication is the session cookie the web client uses: POST /api/login
 * sets `oddjob.sid` and the cookie jar replays it. CREW routes read the
 * speaker from that session (`req.session.userId`), which is why an org API
 * key is not used here: the room would label every turn "Guest".
 */
class OddjobApi(
    private val session: SessionStore,
    val cookieJar: PersistentCookieJar,
    baseClient: OkHttpClient = OkHttpClient(),
) {
    private val json = CrewJson

    /** The signed-in HTTP client (session cookie): images from the room's own routes load through it. */
    val httpClient: OkHttpClient get() = client

    private val client = baseClient.newBuilder()
        .cookieJar(cookieJar)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    /** POST /message answers only once the whole round has finished, which takes minutes with a large crew. */
    private val roundClient = client.newBuilder().readTimeout(10, TimeUnit.MINUTES).build()

    /** The server sends a keepalive comment every 25 s, so 60 s of silence means the stream is dead. */
    private val streamClient = client.newBuilder().readTimeout(60, TimeUnit.SECONDS).build()

    @Volatile private var csrfToken: String? = null

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    private fun base(): HttpUrl {
        val raw = session.serverUrl ?: throw IllegalStateException("No server configured")
        return raw.toHttpUrl()
    }

    private fun url(vararg segments: String, query: Map<String, String?> = emptyMap()): HttpUrl {
        val builder = base().newBuilder()
        // addPathSegment encodes each one, so a room key can never inject a path.
        segments.forEach { builder.addPathSegment(it) }
        query.forEach { (k, v) -> if (v != null) builder.addQueryParameter(k, v) }
        return builder.build()
    }

    private fun crewUrl(sessionKey: String, vararg rest: String, query: Map<String, String?> = emptyMap()): HttpUrl =
        url("api", "crew", sessionKey, *rest, query = query)

    // ---- Auth -------------------------------------------------------------

    suspend fun login(serverUrl: String, identifier: String, password: String): CurrentUser {
        if (session.serverUrl != SessionStore.normalizeServerUrl(serverUrl)) cookieJar.clear()
        session.serverUrl = serverUrl
        csrfToken = null
        val body = buildJsonObject {
            put("username", identifier)
            put("password", password)
        }
        execute(post(url("api", "login"), body))
        val user = currentUser()
        if (!user.authenticated) {
            throw ApiException(401, "NOT_AUTHENTICATED", "Signed in, but the server did not keep the session cookie.")
        }
        session.username = user.username ?: identifier
        return user
    }

    /** GET /api/user answers 200 either way; `authenticated` says which. Also refreshes the CSRF token. */
    suspend fun currentUser(): CurrentUser {
        val user = json.decodeFromString(CurrentUser.serializer(), execute(get(url("api", "user"))))
        user.csrfToken?.let { csrfToken = it }
        return user
    }

    suspend fun logout() {
        runCatching { execute(post(url("api", "logout"), JsonObject(emptyMap()))) }
        cookieJar.clear()
        csrfToken = null
        session.username = null
    }

    // ---- Profile ----------------------------------------------------------

    suspend fun profile(): UserProfile =
        json.decodeFromString(UserProfile.serializer(), execute(get(url("api", "users", "current"))))

    /** Self-service fields only; the server rejects anything else by name. */
    suspend fun updateProfile(changes: JsonObject): UserProfile =
        json.decodeFromString(UserProfile.serializer(), execute(patch(url("api", "users", "me"), changes)))

    // ---- Push -------------------------------------------------------------

    suspend fun pushConfig(): PushConfig =
        json.decodeFromString(PushConfig.serializer(), execute(get(url("api", "push", "config"))))

    suspend fun registerDevice(token: String, appVersion: String) {
        val body = buildJsonObject {
            put("token", token)
            put("platform", "android")
            put("appVersion", appVersion)
        }
        execute(post(url("api", "push", "devices"), body))
    }

    suspend fun unregisterDevice(token: String) {
        val request = Request.Builder()
            .url(url("api", "push", "devices"))
            .delete(buildJsonObject { put("token", token) }.toString().toRequestBody(jsonMedia))
        execute(withHeaders(request, null, mutating = true))
    }

    // ---- Rooms ------------------------------------------------------------

    suspend fun rooms(): List<RoomSummary> =
        json.decodeFromString(RoomsResponse.serializer(), execute(get(url("api", "crew", "rooms", query = mapOf("scope" to "all"))))).rooms

    suspend fun room(sessionKey: String, since: Int? = null, orgId: Int? = null): RoomResponse {
        val query = mapOf("since" to since?.takeIf { it > 0 }?.toString())
        return json.decodeFromString(RoomResponse.serializer(), execute(get(crewUrl(sessionKey, query = query), orgId)))
    }

    /**
     * POST /api/crew/message. Creates the room on first use. Blocks until the
     * round completes; the turns themselves arrive earlier over the stream.
     */
    suspend fun sendMessage(
        sessionKey: String,
        message: String,
        agentCardIds: List<Int>?,
        orgId: Int?,
        selected: List<WorkspaceSelection> = emptyList(),
    ) {
        val body = buildJsonObject {
            put("message", message)
            put("sessionId", sessionKey)
            if (agentCardIds != null) putJsonArray("agentCardIds") { agentCardIds.forEach { add(JsonPrimitive(it)) } }
            // References only: the server re-reads each item from the turn that returned it.
            if (selected.isNotEmpty()) putJsonArray("selectedContext") {
                selected.forEach { s ->
                    add(buildJsonObject { put("turnId", s.turnId); put("tool", s.tool); put("itemId", s.itemId) })
                }
            }
        }
        execute(post(url("api", "crew", "message"), body, orgId), roundClient)
    }

    suspend fun cancelRound(sessionKey: String, orgId: Int?) {
        execute(post(crewUrl(sessionKey, "cancel"), JsonObject(emptyMap()), orgId))
    }

    suspend fun setMode(sessionKey: String, mode: String, orgId: Int?): CrewSession? {
        val body = buildJsonObject { put("mode", mode) }
        val text = execute(patch(crewUrl(sessionKey, "state"), body, orgId))
        return json.decodeFromString(SessionEnvelope.serializer(), text).session
    }

    suspend fun agentCards(orgId: Int?): List<AgentCard> =
        json.decodeFromString(ListSerializer(AgentCard.serializer()), execute(get(url("api", "agent-cards"), orgId)))

    suspend fun setMembers(sessionKey: String, agentCardIds: List<Int>, orgId: Int?): List<AgentCard> {
        val body = buildJsonObject { putJsonArray("agentCardIds") { agentCardIds.forEach { add(JsonPrimitive(it)) } } }
        val request = Request.Builder().url(crewUrl(sessionKey, "members")).put(body.toString().toRequestBody(jsonMedia))
        return json.decodeFromString(MembersEnvelope.serializer(), execute(withHeaders(request, orgId, mutating = true))).members
    }

    /** PUT /:sessionKey/active-agents: this person's agents for the room. Answers with the ids the server kept. */
    suspend fun setActiveAgents(sessionKey: String, agentCardIds: List<Int>, orgId: Int?): List<Int> {
        val body = buildJsonObject { putJsonArray("agentCardIds") { agentCardIds.forEach { add(JsonPrimitive(it)) } } }
        val request = Request.Builder().url(crewUrl(sessionKey, "active-agents")).put(body.toString().toRequestBody(jsonMedia))
        val text = execute(withHeaders(request, orgId, mutating = true))
        return json.decodeFromString(ActiveAgentsEnvelope.serializer(), text).agentCardIds
    }

    /** [kind] is "decisions", "claims" or "commitments". */
    suspend fun createRecord(sessionKey: String, kind: String, text: String, orgId: Int?) {
        val field = when (kind) {
            "decisions" -> "statement"
            "claims" -> "claim"
            "commitments" -> "title"
            else -> throw IllegalArgumentException("Unknown record kind $kind")
        }
        execute(post(crewUrl(sessionKey, kind), buildJsonObject { put(field, text) }, orgId))
    }

    suspend fun updateRecord(sessionKey: String, kind: String, id: Int, status: String, orgId: Int?) {
        execute(patch(crewUrl(sessionKey, kind, id.toString()), buildJsonObject { put("status", status) }, orgId))
    }

    suspend fun conclude(sessionKey: String, orgId: Int?) {
        execute(post(crewUrl(sessionKey, "conclude"), JsonObject(emptyMap()), orgId), roundClient)
    }

    suspend fun reopen(sessionKey: String, orgId: Int?) {
        execute(post(crewUrl(sessionKey, "reopen"), JsonObject(emptyMap()), orgId))
    }

    /** PATCH /:sessionKey/brief: the room's objective, success criteria and scope. */
    suspend fun saveBrief(sessionKey: String, brief: RoomBrief, orgId: Int?): CrewSession? {
        val body = json.encodeToJsonElement(RoomBrief.serializer(), brief).jsonObject
        return json.decodeFromString(SessionEnvelope.serializer(), execute(patch(crewUrl(sessionKey, "brief"), body, orgId))).session
    }

    /** POST /:sessionKey/work-product: a new version of a deliverable, edited by this person. */
    suspend fun saveWorkProduct(sessionKey: String, source: WorkProduct, content: String, changeSummary: String, orgId: Int?): CrewTurn? {
        val body = buildJsonObject {
            put("documentKey", source.documentKey)
            put("title", source.title)
            put("content", content)
            put("changeSummary", changeSummary)
            put("sourceTurnId", source.turnId)
        }
        return json.decodeFromString(TurnEnvelope.serializer(), execute(post(crewUrl(sessionKey, "work-product"), body, orgId))).turn
    }

    /**
     * POST /:sessionKey/financial-snapshots/:id/save: freezes a draft snapshot.
     * True when the server confirms it saved (the row is immutable after that).
     */
    suspend fun saveFinancialSnapshot(sessionKey: String, id: String, orgId: Int?): Boolean {
        val text = execute(post(crewUrl(sessionKey, "financial-snapshots", id, "save", query = mapOf("orgId" to orgId?.toString())), JsonObject(emptyMap()), orgId))
        return (json.parseToJsonElement(text).jsonObject["status"] as? JsonPrimitive)?.contentOrNull == "saved"
    }

    // ---- Readiness and operation skills ------------------------------------

    /** GET /:sessionKey/readiness: tools offered and credential preflight. Availability is not proof of execution. */
    suspend fun readiness(sessionKey: String, orgId: Int?): CrewReadiness {
        val q = mapOf("orgId" to orgId?.toString(), "studio" to "none")
        return CrewReadiness.parse(json.parseToJsonElement(execute(get(crewUrl(sessionKey, "readiness", query = q), orgId))).jsonObject)
    }

    /** POST /:sessionKey/operation-skill-drafts: a verified calendar operation as a skill draft. Registers nothing. */
    suspend fun exportOperationSkill(sessionKey: String, proposalId: Int, orgId: Int?): OperationSkillDraft? {
        val body = buildJsonObject { put("proposalId", proposalId) }
        val text = execute(post(crewUrl(sessionKey, "operation-skill-drafts", query = mapOf("orgId" to orgId?.toString())), body, orgId))
        return OperationSkillDraft.parse(json.parseToJsonElement(text).jsonObject)
    }

    /** GET …/operation-skill-drafts/:hash/review: the scoped draft, the room's agents and its review status. */
    suspend fun operationSkillReview(sessionKey: String, hash: String, orgId: Int?): SkillReviewState? {
        val text = execute(get(crewUrl(sessionKey, "operation-skill-drafts", hash, "review", query = mapOf("orgId" to orgId?.toString())), orgId))
        return SkillReviewState.parse(json.parseToJsonElement(text).jsonObject)
    }

    /**
     * POST …/operation-skill-drafts/:hash/(validate|submit|approve). Validate
     * runs schema checks on mock inputs; submit and approve need organization
     * management permission, which the server enforces.
     */
    suspend fun operationSkillAction(sessionKey: String, hash: String, action: String, body: JsonObject, orgId: Int?): JsonObject {
        require(action in setOf("validate", "submit", "approve"))
        val text = execute(post(crewUrl(sessionKey, "operation-skill-drafts", hash, action, query = mapOf("orgId" to orgId?.toString())), body, orgId))
        return json.parseToJsonElement(text).jsonObject
    }

    /**
     * Re-asks an approved calendar create for its outcome. The server
     * reconciles an executing or unknown create without a second write and
     * returns `calendarAction`; null when it returned none.
     */
    suspend fun recheckCalendarApproval(id: Int, orgId: Int?): JsonObject? {
        val body = buildJsonObject { put("decision", "approved") }
        return json.parseToJsonElement(execute(post(url("api", "approvals", id.toString(), "decision"), body, orgId))).jsonObject["calendarAction"] as? JsonObject
    }

    /** GET /api/approvals/:id/calendar-verification: re-reads an approved event from Google (`found`, `verifiedAt`). */
    suspend fun verifyCalendarApproval(id: Int, orgId: Int?): JsonObject =
        json.parseToJsonElement(execute(get(url("api", "approvals", id.toString(), "calendar-verification"), orgId))).jsonObject

    /**
     * POST /api/oddjob/forms/:requestId/submit: answers an agent's input request,
     * so it leaves the person's inbox (TurnRow's input_request card does the same).
     */
    suspend fun submitInputRequest(requestId: Int, data: JsonObject) {
        execute(post(url("api", "oddjob", "forms", requestId.toString(), "submit"), buildJsonObject { put("data", data) }))
    }

    /** GET /:sessionKey/attachments: the room's files, newest first. */
    suspend fun attachments(sessionKey: String, orgId: Int?): List<CrewAttachment> =
        json.decodeFromString(AttachmentsEnvelope.serializer(), execute(get(crewUrl(sessionKey, "attachments"), orgId))).attachments

    /**
     * POST /:sessionKey/attachments as multipart `files` (up to 5, 25 MB each,
     * the server's limits). The server reads each file before answering (an
     * image goes through image recognition), so this uses the long timeout.
     * Answers with the room's whole file list.
     */
    suspend fun uploadAttachments(sessionKey: String, files: List<UploadFile>, orgId: Int?): AttachmentsEnvelope {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            files.forEach { f -> addFormDataPart("files", f.name, f.bytes.toRequestBody(f.mimeType.toMediaTypeOrNull())) }
        }.build()
        val request = Request.Builder().url(crewUrl(sessionKey, "attachments")).post(body)
        return json.decodeFromString(AttachmentsEnvelope.serializer(), execute(withHeaders(request, orgId, mutating = true), roundClient))
    }

    /**
     * DELETE /:sessionKey/attachments/:id: detaches a file from the room, so its
     * agents no longer search it. Answers with the room's remaining files.
     */
    suspend fun removeAttachment(sessionKey: String, id: Int, orgId: Int?): List<CrewAttachment> {
        val request = Request.Builder().url(crewUrl(sessionKey, "attachments", id.toString(), query = mapOf("organizationId" to orgId?.toString()))).delete()
        return json.decodeFromString(AttachmentsEnvelope.serializer(), execute(withHeaders(request, orgId, mutating = true))).attachments
    }

    // ---- Personal connections -------------------------------------------------

    /**
     * GET /api/me/connections/reauthorizations: connections whose OAuth grant
     * expired and cannot be renewed. [projectId] adds the room's own space to the org-wide ones.
     */
    suspend fun reauthorizations(orgId: Int?, projectId: Int?): List<Reauthorization> {
        val text = execute(get(url("api", "me", "connections", "reauthorizations", query = mapOf("projectId" to projectId?.toString())), orgId))
        return json.decodeFromString(ReauthorizationsEnvelope.serializer(), text).items
    }

    /**
     * GET /api/me/connections/granola/meetings: the signed-in person's own
     * matches for a room's private Granola search, read from their account.
     */
    suspend fun granolaMeetings(orgId: Int, query: String?, list: Map<String, String>): List<GranolaMeeting> {
        val q = mapOf("orgId" to orgId.toString()) + (if (query != null) mapOf("query" to query) else list)
        val text = execute(get(url("api", "me", "connections", "granola", "meetings", query = q), orgId))
        return json.decodeFromString(GranolaMeetingsEnvelope.serializer(), text).meetings
    }

    /** POST /api/me/connections/granola/share: posts one of this person's meetings into the room as their turn. */
    suspend fun shareGranolaMeeting(orgId: Int, sessionKey: String, meetingId: String) {
        val body = buildJsonObject {
            put("sessionKey", sessionKey)
            put("meetingId", meetingId)
        }
        execute(post(url("api", "me", "connections", "granola", "share", query = mapOf("orgId" to orgId.toString())), body, orgId))
    }

    /** GET /:sessionKey/attachments/:id/download: the file's bytes, to open in another app. */
    suspend fun downloadAttachment(sessionKey: String, id: Int, orgId: Int?): ByteArray = withContext(Dispatchers.IO) {
        client.newCall(get(crewUrl(sessionKey, "attachments", id.toString(), "download"), orgId)).execute().use { response ->
            if (!response.isSuccessful) throw parseApiError(response.code, response.body?.string().orEmpty())
            response.body!!.bytes()
        }
    }

    /** POST /:sessionKey/beacon: one position, posted to the room as a map, with a push to everyone else in it. */
    suspend fun raiseBeacon(sessionKey: String, lat: Double, lng: Double, accuracyM: Double?, at: String, orgId: Int?) {
        val body = buildJsonObject {
            put("lat", lat)
            put("lng", lng)
            if (accuracyM != null) put("accuracyM", accuracyM)
            put("at", at)
        }
        execute(post(crewUrl(sessionKey, "beacon"), body, orgId))
    }

    /** POST /:sessionKey/notification-context: posts the email a Gmail alert was about, as a selectable turn. */
    suspend fun notificationContext(sessionKey: String, eventId: Int, orgId: Int?): NotificationContext {
        val body = buildJsonObject { put("eventId", eventId) }
        return json.decodeFromString(NotificationContext.serializer(), execute(post(crewUrl(sessionKey, "notification-context"), body, orgId)))
    }

    /** The web route for a room, for surfaces the app does not render natively. */
    fun webRoomUrl(sessionKey: String, orgId: Int?): String =
        url("workspace", "chat", sessionKey, query = mapOf("orgId" to orgId?.toString())).toString()

    /** GET /api/crew/:sessionKey/stream as server-sent events. The caller owns cancel(). */
    fun openStream(sessionKey: String, orgId: Int?, listener: EventSourceListener): EventSource {
        val request = Request.Builder()
            .url(crewUrl(sessionKey, "stream", query = mapOf("orgId" to orgId?.toString())))
            .header("Accept", "text/event-stream")
            .build()
        return EventSources.createFactory(streamClient).newEventSource(request, listener)
    }

    // ---- Approvals --------------------------------------------------------

    /** GET /api/approvals: what is waiting on this person, newest first. */
    suspend fun approvals(): List<ApprovalView> =
        json.decodeFromString(ListSerializer(JsonObject.serializer()), execute(get(url("api", "approvals"))))
            .map(Approvals::fromInbox)

    /**
     * POST /api/approvals/:id/decision. Never throws: the card shows every
     * answer, including "someone decided first", in place. [code] answers a
     * verification challenge and travels as `modifiedOutput.solution`, as the web sends it.
     */
    suspend fun decideApproval(
        id: Int,
        approved: Boolean,
        code: String? = null,
        edits: Map<String, String> = emptyMap(),
        /** The room's org: approval rows are org-scoped, so a room outside the default org must name it. */
        orgId: Int? = null,
    ): DecisionOutcome = runCatching {
        val body = buildJsonObject {
            put("decision", if (approved) "approved" else "rejected")
            when {
                approved && !code.isNullOrBlank() -> put("modifiedOutput", buildJsonObject { put("solution", code.trim()) })
                // Edit & send: body and subject only. The server keeps recipients and channel from the stored proposal.
                approved && edits.isNotEmpty() -> put("modifiedOutput", buildJsonObject { edits.forEach { (k, v) -> put(k, v) } })
            }
        }
        val response = json.parseToJsonElement(execute(post(url("api", "approvals", id.toString(), "decision"), body, orgId))).jsonObject
        decisionOutcome(response, approved)
    }.getOrElse { decisionFailure(it) }

    /** GET /api/approvals/:id: the stored row, for a card whose turn snapshot may be stale. */
    suspend fun approval(id: Int, orgId: Int? = null): ReadBack =
        Approvals.readBack(json.parseToJsonElement(execute(get(url("api", "approvals", id.toString()), orgId))).jsonObject)

    // ---- Computer use -----------------------------------------------------

    private fun computerUseUrl(taskId: String, vararg rest: String): HttpUrl =
        url("api", "integrations", "trycua", "computer-use", "tasks", taskId, *rest)

    /** A task's current state, for answering a pause. [orgId] is the task's org, from the push. */
    suspend fun computerUseTask(taskId: String, orgId: Int?): ComputerUseTask =
        json.decodeFromString(ComputerUseTaskEnvelope.serializer(), execute(get(computerUseUrl(taskId), orgId))).task

    /**
     * Answers a paused task. Continuing resumes the agent inside this request,
     * so it returns only when the agent next stops: hence the round client.
     * [text] is the reply the agent asked for (a code, "done, I logged in").
     */
    suspend fun confirmComputerUseTask(taskId: String, allow: Boolean, text: String?, orgId: Int?): ComputerUseTask {
        val body = buildJsonObject {
            put("allow", allow)
            if (!text.isNullOrBlank()) put("text", text.trim())
        }
        val response = execute(post(computerUseUrl(taskId, "confirm"), body, orgId), roundClient)
        return json.decodeFromString(ComputerUseTaskEnvelope.serializer(), response).task
    }

    // ---- Plumbing ---------------------------------------------------------

    private fun get(url: HttpUrl, orgId: Int? = null): Request =
        withHeaders(Request.Builder().url(url).get(), orgId, mutating = false)

    private fun post(url: HttpUrl, body: JsonObject, orgId: Int? = null): Request =
        withHeaders(Request.Builder().url(url).post(body.toString().toRequestBody(jsonMedia)), orgId, mutating = true)

    private fun patch(url: HttpUrl, body: JsonObject, orgId: Int? = null): Request =
        withHeaders(Request.Builder().url(url).patch(body.toString().toRequestBody(jsonMedia)), orgId, mutating = true)

    private fun withHeaders(builder: Request.Builder, orgId: Int?, mutating: Boolean): Request {
        builder.header("Accept", "application/json")
        // A shared room can live in another org than the session's default;
        // the web client pins the room's org the same way.
        if (orgId != null) builder.header("x-organization-id", orgId.toString())
        if (mutating) csrfToken?.let { builder.header("x-csrf-token", it) }
        return builder.build()
    }

    private suspend fun execute(request: Request, using: OkHttpClient = client): String = withContext(Dispatchers.IO) {
        using.newCall(request).execute().use { response -> readOrThrow(response) }
    }

    private fun readOrThrow(response: Response): String {
        val text = response.body?.string().orEmpty()
        if (response.isSuccessful) return text
        // Method, path and status only: never headers, cookies or bodies.
        runCatching {
            android.util.Log.w("OddjobApi", "${response.request.method} ${response.request.url.encodedPath} -> ${response.code}")
        }
        throw parseApiError(response.code, text)
    }

    /**
     * Whether the server still recognises this session. A 401 on one route is
     * confirmed here before the app signs the user out, so a single misrouted
     * or transient denial cannot end a session that is still good.
     */
    suspend fun sessionIsValid(): Boolean = runCatching { currentUser().authenticated }.getOrDefault(true)
}

/**
 * The server answers errors in three shapes: `{ error: { code, message } }`
 * from the error handler, `{ message }` from requireAuth, and
 * `{ error: "..." }` from a few record routes.
 */
fun parseApiError(status: Int, body: String): ApiException {
    val obj = runCatching { CrewJson.parseToJsonElement(body) as? JsonObject }.getOrNull()
    val error = obj?.get("error")
    var code: String? = null
    var message: String? = null
    when (error) {
        is JsonObject -> {
            code = (error["code"] as? JsonPrimitive)?.contentOrNull
            message = (error["message"] as? JsonPrimitive)?.contentOrNull
        }
        is JsonPrimitive -> message = error.contentOrNull
        else -> Unit
    }
    message = message ?: (obj?.get("message") as? JsonPrimitive)?.contentOrNull
    return ApiException(
        status,
        code,
        message ?: if (status == 401) "Your session has expired. Sign in again." else "Request failed ($status)",
    )
}

/** The `payload.turn` of a `turn-content` stream frame, when it carries one. */
fun turnFromStreamFrame(data: String): CrewTurn? = runCatching {
    val turn = CrewJson.parseToJsonElement(data).jsonObject["payload"]?.jsonObject?.get("turn")
        ?: return@runCatching null
    CrewJson.decodeFromJsonElement(CrewTurn.serializer(), turn)
}.getOrNull()

/** The `payload.speakerType` of a `turn` stream frame. */
fun speakerTypeFromStreamFrame(data: String): String? = runCatching {
    (CrewJson.parseToJsonElement(data).jsonObject["payload"]?.jsonObject?.get("speakerType"))
        ?.jsonPrimitive?.contentOrNull
}.getOrNull()
