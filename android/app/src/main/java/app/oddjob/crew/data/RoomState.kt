package app.oddjob.crew.data

/**
 * Everything the room screen shows, and how server answers fold into it.
 *
 * Mirrors applyRoom/appendTurn in client/src/components/agent-chat/useCrewSession.ts:
 * a full read replaces, a `since` delta merges by id, and the cursor only ever
 * moves forward, so an empty delta can never rewind the client into
 * re-downloading what it already holds.
 */
data class RoomState(
    val session: CrewSession? = null,
    val members: List<AgentCard> = emptyList(),
    val turns: List<CrewTurn> = emptyList(),
    val notes: List<SupervisorNote> = emptyList(),
    val decisions: List<Decision> = emptyList(),
    val claims: List<Claim> = emptyList(),
    val commitments: List<Commitment> = emptyList(),
    val participants: List<Participant> = emptyList(),
    val workProductTurns: List<WorkProductTurn> = emptyList(),
    val currentUserId: String? = null,
    val cursor: Int = 0,
) {
    /** Every work-product version in the room, oldest first. */
    val workProducts: List<WorkProduct> get() = WorkProduct.collect(turns, workProductTurns)

    /** The room's own org, once the server has told us; null for a room not yet created. */
    val orgId: Int? get() = session?.organizationId

    fun apply(response: RoomResponse): RoomState {
        val delta = response.delta
        val nextTurns = if (delta) mergeTurns(turns, response.turns) else response.turns.sortedBy { it.id }
        val responseCursor = response.cursor ?: 0
        return copy(
            session = response.session ?: if (delta) session else null,
            // Members ride along in deltas too; an empty list only means "none"
            // on a full read.
            members = if (response.members.isNotEmpty() || !delta) response.members else members,
            turns = nextTurns,
            notes = if (delta) mergeById(notes, response.notes, { it.id }, descending = false) else response.notes,
            decisions = if (delta) mergeById(decisions, response.decisions, { it.id }, descending = true) else response.decisions,
            claims = if (delta) mergeById(claims, response.claims, { it.id }, descending = true) else response.claims,
            commitments = if (delta) mergeById(commitments, response.commitments, { it.id }, descending = true) else response.commitments,
            participants = response.participants,
            // Sent whole on every read, deltas included.
            workProductTurns = response.workProductTurns,
            currentUserId = response.currentUserId ?: currentUserId,
            cursor = if (delta) maxOf(cursor, responseCursor, nextTurns.lastOrNull()?.id ?: 0) else (nextTurns.lastOrNull()?.id ?: 0),
        )
    }

    /** A turn delivered live over the stream, before the next fetch confirms it. */
    fun appendTurn(turn: CrewTurn): RoomState {
        val next = mergeTurns(turns, listOf(turn))
        return copy(turns = next, cursor = maxOf(cursor, turn.id))
    }

    companion object {
        fun mergeTurns(existing: List<CrewTurn>, incoming: List<CrewTurn>): List<CrewTurn> {
            if (incoming.isEmpty()) return existing
            val byId = LinkedHashMap<Int, CrewTurn>(existing.size + incoming.size)
            existing.forEach { byId[it.id] = it }
            // The later copy wins: a refetch can carry a turn the stream
            // delivered with fewer fields.
            incoming.forEach { byId[it.id] = it }
            return byId.values.sortedBy { it.id }
        }

        fun <T> mergeById(existing: List<T>, incoming: List<T>, id: (T) -> Int, descending: Boolean): List<T> {
            if (incoming.isEmpty()) return existing
            val byId = LinkedHashMap<Int, T>()
            existing.forEach { byId[id(it)] = it }
            incoming.forEach { byId[id(it)] = it }
            return if (descending) byId.values.sortedByDescending(id) else byId.values.sortedBy(id)
        }
    }
}

/** What a frame from GET /api/crew/:sessionKey/stream asks the room to do. */
sealed interface StreamAction {
    data class AppendTurn(val turn: CrewTurn) : StreamAction
    /** Something changed that only a fetch can show. */
    data object Refresh : StreamAction
    /** The round is over, finished or cancelled: stop showing it as running. */
    data object RoundEnded : StreamAction
    data object Ignore : StreamAction
}

object StreamFrames {
    /**
     * Same dispatch as the web client's onMessage. An agent's `turn` frame is
     * ignored because its `turn-content` frame carries the turn itself; a user
     * or supervisor `turn` has no content frame, so it triggers a fetch.
     */
    fun interpret(event: String?, data: String): StreamAction = when (event) {
        "turn-content" -> turnFromStreamFrame(data)?.let { StreamAction.AppendTurn(it) } ?: StreamAction.Refresh
        "turn" -> if (speakerTypeFromStreamFrame(data) == "agent") StreamAction.Ignore else StreamAction.Refresh
        "round-complete", "round-cancelled" -> StreamAction.RoundEnded
        "participant", "ready", "blackboard-sync", "scribe-document-updated" -> StreamAction.Refresh
        else -> StreamAction.Ignore
    }
}

/** Matches the web client's key format (AgentChatPanel.tsx), so rooms are interchangeable. */
fun newRoomKey(now: Long = System.currentTimeMillis(), random: kotlin.random.Random = kotlin.random.Random): String {
    val alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    val suffix = (1..7).map { alphabet[random.nextInt(alphabet.length)] }.joinToString("")
    return "crew-$now-$suffix"
}
