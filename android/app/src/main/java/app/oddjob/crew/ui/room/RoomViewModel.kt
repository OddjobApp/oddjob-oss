package app.oddjob.crew.ui.room

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.oddjob.crew.data.AgentCard
import app.oddjob.crew.data.AgentSelection
import app.oddjob.crew.data.ApiException
import app.oddjob.crew.data.ApprovalView
import app.oddjob.crew.data.Approvals
import app.oddjob.crew.data.DecisionOutcome
import app.oddjob.crew.data.OddjobApi
import app.oddjob.crew.data.RoomState
import app.oddjob.crew.data.StreamAction
import app.oddjob.crew.data.StreamFrames
import app.oddjob.crew.data.CrewText
import app.oddjob.crew.data.RecordCard
import app.oddjob.crew.data.RoomBrief
import app.oddjob.crew.data.WorkProduct
import app.oddjob.crew.data.Workspace
import app.oddjob.crew.data.WorkspaceAction
import app.oddjob.crew.data.WorkspaceSelection
import app.oddjob.crew.data.RoomCache
import kotlinx.serialization.json.JsonObject
import app.oddjob.crew.data.ApiOperationSkills
import app.oddjob.crew.data.CrewReadiness
import app.oddjob.crew.data.OperationSkills
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener

data class RoomUiState(
    val room: RoomState = RoomState(),
    val loading: Boolean = true,
    /** This device's POST /message is in flight. */
    val sending: Boolean = false,
    /** A round is running, started here or by another participant. */
    val roundActive: Boolean = false,
    /** Sent but not yet echoed back as a turn. */
    val pendingMessage: String? = null,
    val streamConnected: Boolean = false,
    val error: String? = null,
    val signedOut: Boolean = false,
    val availableCards: List<AgentCard>? = null,
    /**
     * A crew chosen before the room exists. PUT /members cannot create a room
     * (only POST /message does), so the choice rides on the first message.
     */
    val draftMemberIds: List<Int>? = null,
    /** Agents chosen on this phone; null until the person changes them (then the saved choice or the roster applies). */
    val selectedAgentIds: List<Int>? = null,
    /** The room's files, and whether an upload is in flight. */
    val attachments: List<app.oddjob.crew.data.CrewAttachment> = emptyList(),
    val uploading: Boolean = false,
    /** The file being detached from the room, while the request is in flight. */
    val removingAttachmentId: Int? = null,
    /** Connections whose authorization expired and cannot be renewed, for the banner over the room. */
    val reauthorizations: List<app.oddjob.crew.data.Reauthorization> = emptyList(),
    /** Result items chosen as context for the next message. */
    val selected: List<WorkspaceSelection> = emptyList(),
    /** Text a card action puts in the composer for the person to review and send. */
    val composerPrefill: String? = null,
    /** The Gmail alert this room was opened from, while its email is fetched or after it failed. */
    val alert: AlertHandoff? = null,
    /** What is shown came from this phone's saved copy and the server has not confirmed it yet. */
    val fromCache: Boolean = false,
)

/** Opening a room from a Gmail directive push: the email that triggered it, loaded as selected context. */
data class AlertHandoff(val eventId: Int, val loading: Boolean, val title: String? = null, val reason: String? = null, val error: String? = null)

private sealed interface StreamSignal {
    data object Open : StreamSignal
    data class Frame(val event: String?, val data: String) : StreamSignal
}

class RoomViewModel(
    private val api: OddjobApi,
    val sessionKey: String,
    private val cache: RoomCache? = null,
    /** Outlives the screen, so the last save still lands after the room is left. */
    private val saveScope: CoroutineScope? = null,
    /** The org the room list or link named, used until the room's own session says. */
    private val initialOrgId: Int? = null,
) : ViewModel() {
    private val _state = MutableStateFlow(RoomUiState())
    val state: StateFlow<RoomUiState> = _state

    /** Coalesces refetch requests: a burst of stream frames costs one delta fetch, not one each. */
    private val refreshRequests = Channel<Boolean>(Channel.CONFLATED)
    private var streamJob: Job? = null

    private val orgId: Int? get() = _state.value.room.orgId ?: initialOrgId

    init {
        // The saved copy shows at once; the full read below replaces it.
        cache?.let { c ->
            viewModelScope.launch {
                val saved = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { runCatching { c.loadRoom(sessionKey) }.getOrNull() }
                if (saved != null) _state.update { s ->
                    if (s.room.session != null) s else s.copy(room = saved, loading = false, fromCache = true)
                }
            }
        }
        viewModelScope.launch {
            for (full in refreshRequests) fetch(full)
        }
        refresh(full = true)
        viewModelScope.launch {
            runCatching { api.agentCards(null) }.onSuccess { cards -> _state.update { it.copy(availableCards = cards) } }
        }
    }

    fun refresh(full: Boolean = false) {
        refreshRequests.trySend(full)
    }

    private suspend fun fetch(full: Boolean) {
        val current = _state.value.room
        val since = if (full) null else current.cursor.takeIf { it > 0 }
        runCatching { api.room(sessionKey, since, orgId) }
            .onSuccess { response ->
                _state.update { s ->
                    val next = s.room.apply(response)
                    s.copy(
                        room = next,
                        loading = false,
                        fromCache = false,
                        pendingMessage = s.pendingMessage?.takeUnless { pending -> echoed(next, pending) },
                    )
                }
                scheduleSave()
            }
            .onFailure(::fail)
    }

    /** A message sent with selected items is stored with their context appended; only the typed part is compared. */
    private fun echoed(room: RoomState, pending: String): Boolean =
        room.turns.takeLast(20).any { it.speakerType == "user" && CrewText.splitWorkspaceContext(it.content).message.trim() == pending.trim() }

    // ---- Live stream ------------------------------------------------------

    /** Called while the screen is visible; the stream is not held in the background. */
    fun startStream() {
        if (streamJob?.isActive == true) return
        streamJob = viewModelScope.launch {
            var backoffMs = 1_000L
            var opened = false
            while (true) {
                runCatching {
                    streamFrames().collect { signal ->
                        when (signal) {
                            StreamSignal.Open -> {
                                backoffMs = 1_000L
                                _state.update { it.copy(streamConnected = true) }
                                // A reopened stream may have missed frames, so it reconciles.
                                if (opened) refresh()
                                opened = true
                            }
                            is StreamSignal.Frame -> handleFrame(signal.event, signal.data)
                        }
                    }
                }.onFailure { e ->
                    if ((e as? ApiException)?.isUnauthorized == true && !api.sessionIsValid()) {
                        _state.update { it.copy(signedOut = true, streamConnected = false) }
                        return@launch
                    }
                }
                _state.update { it.copy(streamConnected = false) }
                delay(backoffMs)
                backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
            }
        }
    }

    fun stopStream() {
        streamJob?.cancel()
        streamJob = null
        _state.update { it.copy(streamConnected = false) }
    }

    private fun streamFrames() = callbackFlow {
        val source = api.openStream(sessionKey, orgId, object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                trySend(StreamSignal.Open)
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                trySend(StreamSignal.Frame(type, data))
            }

            override fun onClosed(eventSource: EventSource) {
                close()
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                val code = response?.code
                close(if (code != null && code >= 400) ApiException(code, null, "Stream refused ($code)") else t)
            }
        })
        awaitClose { source.cancel() }
    }

    private fun handleFrame(event: String?, data: String) {
        if (event == "turn" && data.contains("\"speakerType\":\"user\"")) {
            // Someone, here or elsewhere, opened a round.
            _state.update { it.copy(roundActive = true) }
        }
        when (val action = StreamFrames.interpret(event, data)) {
            is StreamAction.AppendTurn -> {
                _state.update { s ->
                    val next = s.room.appendTurn(action.turn)
                    s.copy(room = next, pendingMessage = s.pendingMessage?.takeUnless { echoed(next, it) })
                }
                scheduleSave()
            }
            StreamAction.Refresh -> refresh()
            StreamAction.RoundEnded -> {
                _state.update { it.copy(roundActive = it.sending) }
                refresh()
            }
            StreamAction.Ignore -> Unit
        }
    }

    // ---- Actions ----------------------------------------------------------

    /**
     * Sends a message. [withSelection] is true for what the person typed: the
     * items they selected ride along, and are cleared once sent. A card's own
     * reply (a form submission, a decision line) goes without them.
     */
    fun send(text: String, withSelection: Boolean = false) {
        val message = text.trim()
        if (message.isEmpty() || _state.value.sending) return
        val selected = if (withSelection) _state.value.selected else emptyList()
        _state.update { it.copy(sending = true, roundActive = true, pendingMessage = message, error = null) }
        viewModelScope.launch {
            val s = _state.value
            // A brand-new room takes the crew picked before it existed; an existing
            // one, the agents this person has selected. Either seats exactly them.
            val agents = if (s.room.session == null) s.draftMemberIds else AgentSelection.resolve(s.selectedAgentIds, s.room, s.availableCards)
            runCatching { api.sendMessage(sessionKey, message, agentCardIds = agents, orgId = orgId, selected = selected) }
                .onSuccess {
                    _state.update { s -> s.copy(draftMemberIds = null, selected = s.selected.filterNot { x -> selected.any(x::sameSlot) }) }
                }
                .onFailure { e ->
                    fail(e)
                    _state.update { it.copy(pendingMessage = null) }
                }
            _state.update { it.copy(sending = false, roundActive = false) }
            // A brand-new room only learns its org from this fetch.
            refresh(full = _state.value.room.session == null)
        }
    }

    /**
     * Decides an approval card in this room, then posts the same line the web
     * card posts, so the crew learns of the decision either way. A card without
     * an id (a proposal that only lives in the turn) is recorded by that line alone.
     */
    suspend fun decideApproval(view: ApprovalView, approved: Boolean, code: String?, edits: Map<String, String>): DecisionOutcome {
        val outcome = view.id?.let { api.decideApproval(it, approved, code, edits, orgId) }
            ?: DecisionOutcome.Recorded(if (approved) "approved" else "rejected", null)
        // A calendar decision posts nothing: the card shows the stored outcome, and a
        // room message would reattach the selected email and start scheduling again (as on the web).
        if (outcome is DecisionOutcome.Recorded && view.kind != "calendar_action") {
            send(Approvals.decisionMessage(view, approved, outcome.assembly, outcome.action, outcome.outbound))
        }
        return outcome
    }

    /** Re-asks an approved calendar create for its outcome; the server never writes a second event. */
    suspend fun recheckCalendar(id: Int): JsonObject? = api.recheckCalendarApproval(id, orgId)

    /** Re-reads an approved calendar event from Google; throws when it could not be read. */
    suspend fun verifyCalendar(id: Int): JsonObject = api.verifyCalendarApproval(id, orgId)

    // ---- Granola -------------------------------------------------------------

    /** This person's own matches for a private Granola search in the room. */
    suspend fun granolaMeetings(card: app.oddjob.crew.data.GranolaPrivateResults): Result<List<app.oddjob.crew.data.GranolaMeeting>> =
        runCatching { api.granolaMeetings(card.organizationId, card.query, card.list) }

    /** Shares one meeting's notes into the room; null on success, else why not. The stream brings the turn. */
    suspend fun shareGranola(card: app.oddjob.crew.data.GranolaPrivateResults, meetingId: String): String? =
        runCatching { api.shareGranolaMeeting(card.organizationId, card.sessionKey, meetingId) }
            .fold({ refresh(); null }, { it.message ?: "Could not share this meeting." })

    // ---- Expired connections ---------------------------------------------------

    /** Loads the reauthorize banner; a failed read leaves it as it was, as on the web. */
    fun loadReauthorizations() {
        val session = _state.value.room.session ?: return
        viewModelScope.launch {
            runCatching { api.reauthorizations(session.organizationId, session.projectId) }
                .onSuccess { items -> _state.update { it.copy(reauthorizations = items) } }
        }
    }

    /** Skill draft export and review, scoped to the room each call names. */
    val operationSkills: OperationSkills = ApiOperationSkills(api)

    /** This room's tools and credential preflight; availability is not proof a tool will run. */
    suspend fun readiness(): Result<CrewReadiness> = runCatching { api.readiness(sessionKey, orgId) }

    /** The stored approval, for a card whose turn snapshot may predate its decision. */
    suspend fun readApproval(id: Int) = runCatching { api.approval(id, orgId) }.getOrNull()

    // ---- Selected items ----------------------------------------------------

    /** Replaces the selection within one result card, keeping items chosen from other cards (max 20, as on the web). */
    fun setCardSelection(turnId: Int, tool: String, resultIndex: Int, items: List<WorkspaceSelection>) = _state.update { s ->
        val others = s.selected.filterNot { it.turnId == turnId && it.tool == tool && it.resultIndex == resultIndex }
        s.copy(selected = (others + items).take(20))
    }

    fun unselect(item: WorkspaceSelection) = _state.update { s -> s.copy(selected = s.selected.filterNot(item::sameSlot)) }

    fun clearSelection() = _state.update { it.copy(selected = emptyList()) }

    /** Discuss / Draft reply / Summarize: select exactly these items and put the matching request in the composer. */
    fun actOn(items: List<WorkspaceSelection>, action: WorkspaceAction) = _state.update {
        it.copy(selected = items, composerPrefill = Workspace.prompt(items.map(WorkspaceSelection::item), action))
    }

    fun consumePrefill() = _state.update { it.copy(composerPrefill = null) }

    // ---- Gmail alert handoff -------------------------------------------------

    /** Loads the email a Gmail directive push was about and selects it. Called once the room exists. */
    fun openAlert(eventId: Int) {
        if (_state.value.alert?.eventId == eventId && _state.value.alert?.error == null) return
        _state.update { it.copy(alert = AlertHandoff(eventId, loading = true)) }
        viewModelScope.launch {
            runCatching { api.notificationContext(sessionKey, eventId, orgId) }
                .onSuccess { ctx ->
                    val item = ctx.payload?.items?.firstOrNull()
                    val turn = ctx.turn
                    if (item == null || turn == null) {
                        _state.update { it.copy(alert = AlertHandoff(eventId, false, error = "The email context is unavailable.")) }
                        return@onSuccess
                    }
                    _state.update { s ->
                        s.copy(
                            room = s.room.appendTurn(turn),
                            selected = listOf(WorkspaceSelection(turn.id, "gmail_get_message", 0, item)),
                            alert = AlertHandoff(eventId, false, title = item.title, reason = ctx.reason),
                        )
                    }
                }
                .onFailure { e -> _state.update { it.copy(alert = AlertHandoff(eventId, false, error = e.message ?: "Could not load the triggering email.")) } }
        }
    }

    fun dismissAlert() = _state.update { it.copy(alert = null) }

    // ---- Attachments -------------------------------------------------------------

    private var attachmentsLoaded = false

    /** Loads the room's files once the room exists (a draft room cannot hold any). */
    fun loadAttachments(force: Boolean = false) {
        if (_state.value.room.session == null || (attachmentsLoaded && !force)) return
        attachmentsLoaded = true
        viewModelScope.launch {
            runCatching { api.attachments(sessionKey, orgId) }
                .onSuccess { list -> _state.update { it.copy(attachments = list) } }
                // A room outside a project has no attachments; that is not an error to show.
                .onFailure { attachmentsLoaded = false }
        }
    }

    /** Uploads picked files. Null on success, else what to tell the person. */
    suspend fun upload(files: List<app.oddjob.crew.data.UploadFile>): String? {
        if (files.isEmpty()) return null
        if (_state.value.room.session == null) return "Send a first message to open the room, then attach files."
        _state.update { it.copy(uploading = true) }
        val result = runCatching { api.uploadAttachments(sessionKey, files.take(MAX_FILES), orgId) }
        _state.update { s ->
            val sent = result.getOrNull()
            s.copy(
                uploading = false,
                attachments = sent?.attachments ?: s.attachments,
                // The upload's own turn shows at once; the stream would bring it a moment later.
                room = sent?.turn?.let { s.room.appendTurn(it) } ?: s.room,
            )
        }
        if (result.isSuccess) scheduleSave()
        return result.exceptionOrNull()?.let { (it as? ApiException)?.message ?: "Upload failed: ${it.message}" }
    }

    /** Detaches a file from the room, so its agents stop searching it. Null on success, else what to tell the person. */
    suspend fun removeAttachment(id: Int): String? {
        _state.update { it.copy(removingAttachmentId = id) }
        val result = runCatching { api.removeAttachment(sessionKey, id, orgId) }
        _state.update { s -> s.copy(removingAttachmentId = null, attachments = result.getOrNull() ?: s.attachments) }
        return result.exceptionOrNull()?.let { (it as? ApiException)?.message ?: "Could not remove the file from this room." }
    }

    /**
     * An agent's or app's input request answered: record the answer, then post it
     * to the room so the agent can act on it. An answer the server did not record
     * (already answered elsewhere, say) is not announced. Null on success, else why.
     */
    suspend fun answerInputRequest(requestId: Int?, message: String, data: kotlinx.serialization.json.JsonObject): String? {
        if (requestId != null) {
            val failure = runCatching { api.submitInputRequest(requestId, data) }.exceptionOrNull()
            if (failure != null) return failure.message?.takeIf { it.isNotBlank() }?.let { "Not submitted: $it" } ?: "Not submitted. Try again."
        }
        send(message)
        return null
    }

    /** Freezes a financial snapshot. Null on success, else what to tell the person. */
    suspend fun saveFinancialSnapshot(sessionKey: String, id: String, orgId: Int?): String? = runCatching {
        if (!api.saveFinancialSnapshot(sessionKey, id, orgId ?: this.orgId)) "The server did not confirm the save." else null
    }.getOrElse { it.message ?: "Could not save the snapshot." }

    /** A room file's bytes, for opening a document in another app. */
    suspend fun downloadAttachment(id: Int): Result<ByteArray> = runCatching { api.downloadAttachment(sessionKey, id, orgId) }

    /** The org a room's file requests must carry (x-organization-id), once the room has loaded. */
    val roomOrgId: Int? get() = orgId

    // ---- Location beacon -------------------------------------------------------

    /** Shares one position with the room. Null on success, else what to tell the person. */
    suspend fun raiseBeacon(fix: BeaconFix): String? = runCatching {
        api.raiseBeacon(sessionKey, fix.lat, fix.lng, fix.accuracyM, fix.at, orgId)
        refresh()
    }.exceptionOrNull()?.let { (it as? ApiException)?.message ?: "Couldn't share your location: ${it.message}" }

    // ---- Brief, work products and record cards -------------------------------

    suspend fun saveBrief(brief: RoomBrief): String? = runCatching {
        api.saveBrief(sessionKey, brief, orgId)?.let { session -> _state.update { it.copy(room = it.room.copy(session = session)) } }
    }.exceptionOrNull()?.message

    suspend fun saveWorkProduct(source: WorkProduct, content: String, changeSummary: String): String? = runCatching {
        api.saveWorkProduct(sessionKey, source, content, changeSummary, orgId)?.let { turn ->
            _state.update { it.copy(room = it.room.appendTurn(turn)) }
        }
    }.exceptionOrNull()?.message

    /**
     * A record card's status change: patched by this room's key (the web card
     * patches by the numeric session id, which the route does not accept), then
     * announced so the crew learns of it.
     */
    suspend fun changeRecord(card: RecordCard, status: String): String? {
        val id = card.id
        if (id != null) {
            runCatching { api.updateRecord(sessionKey, card.kind, id, status, orgId) }
                .onFailure { return it.message ?: "Could not update the record." }
        }
        send(card.changeMessage(status))
        refresh(full = true)
        return null
    }

    fun cancelRound() = act { api.cancelRound(sessionKey, orgId) }

    fun setMode(mode: String) = act {
        api.setMode(sessionKey, mode, orgId)?.let { session ->
            _state.update { it.copy(room = it.room.copy(session = session)) }
        }
    }

    fun loadAgentCards() = act {
        val cards = api.agentCards(orgId)
        _state.update { it.copy(availableCards = cards) }
    }

    fun saveMembers(ids: List<Int>) {
        if (_state.value.room.session == null) {
            val chosen = _state.value.availableCards.orEmpty().filter { it.id in ids }
            _state.update { it.copy(draftMemberIds = ids, room = it.room.copy(members = chosen)) }
            return
        }
        setSelection(ids)
    }

    /** The agents in force for this person now. */
    fun selection(): List<Int> = _state.value.let { AgentSelection.resolve(it.selectedAgentIds, it.room, it.availableCards) }

    /** Select or deselect one agent. */
    fun toggleAgent(id: Int) {
        if (_state.value.room.session == null) {
            val current = _state.value.draftMemberIds ?: _state.value.room.members.map { it.id }
            saveMembers(AgentSelection.toggle(current, id))
            return
        }
        setSelection(AgentSelection.toggle(selection(), id))
    }

    private var selectionSave: Job? = null

    /**
     * Applies at once and is saved for this person, so the web and a later
     * visit open with it. Saves are serialized: the last choice is the one kept.
     */
    fun setSelection(ids: List<Int>) {
        _state.update { it.copy(selectedAgentIds = ids) }
        val previous = selectionSave
        selectionSave = viewModelScope.launch {
            previous?.join()
            runCatching { api.setActiveAgents(sessionKey, ids, orgId) }
                .onFailure { _state.update { s -> s.copy(error = "Your agent choice applies here, but could not be saved to the server.") } }
        }
    }

    fun createRecord(kind: String, text: String) = act(fullRefresh = true) {
        api.createRecord(sessionKey, kind, text.trim(), orgId)
    }

    fun updateRecord(kind: String, id: Int, status: String) = act(fullRefresh = true) {
        api.updateRecord(sessionKey, kind, id, status, orgId)
    }

    fun conclude() = act(fullRefresh = true) { api.conclude(sessionKey, orgId) }

    fun reopen() = act(fullRefresh = true) { api.reopen(sessionKey, orgId) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun webUrl(): String = api.webRoomUrl(sessionKey, orgId)

    private fun act(fullRefresh: Boolean = false, block: suspend () -> Unit) {
        viewModelScope.launch {
            runCatching { block() }
                .onSuccess { if (fullRefresh) refresh(full = true) }
                .onFailure(::fail)
        }
    }

    private fun fail(e: Throwable) {
        val apiError = e as? ApiException
        if (apiError?.isUnauthorized == true) {
            viewModelScope.launch {
                if (!api.sessionIsValid()) _state.update { it.copy(signedOut = true, loading = false) }
                else _state.update { it.copy(loading = false, error = apiError.message) }
            }
            return
        }
        val api = apiError
        val message = when {
            api?.status == 429 -> "The crew is still settling the last round. Try again in a moment."
            api?.code == "NO_CREW_MEMBERS" -> "This room has no agents yet. Add some from Crew."
            else -> e.message ?: "Something went wrong."
        }
        _state.update { it.copy(loading = false, error = message) }
    }

    // ---- Saved copy ----------------------------------------------------------

    private var saveJob: Job? = null

    /** Saves a moment after the last change, so a burst of streamed turns is one write. */
    private fun scheduleSave() {
        val scope = saveScope ?: return
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(1_500)
            saveNow()
        }
    }

    private fun saveNow() {
        val room = _state.value.room
        if (_state.value.fromCache) return // nothing new to write until the server answers
        runCatching { cache?.saveRoom(sessionKey, room) }
    }

    companion object {
        /** The server's per-upload limits (crew.routes.ts attachmentUpload). */
        const val MAX_FILES = 5
        const val MAX_BYTES = 25L * 1024 * 1024
    }

    override fun onCleared() {
        refreshRequests.close()
        saveJob?.cancel()
        saveScope?.launch { saveNow() }
        super.onCleared()
    }
}
