package app.oddjob.crew.data

import kotlinx.serialization.Serializable
import java.io.File
import java.security.MessageDigest

/**
 * The last state of recently opened rooms, and the rooms list, on this phone,
 * so a room opens at once and can be read without a connection. The server is
 * still the truth: every open does a full read in the background and replaces
 * what is shown.
 *
 * Kept in the app's private cache directory (never backed up: allowBackup is
 * off). Each file names the server and account it belongs to and is ignored
 * for anyone else, so switching accounts cannot show another person's rooms;
 * sign-out deletes all of it.
 */
class RoomCache(private val dir: File, private val owner: () -> String?) {
    @Serializable
    private data class CachedRoom(
        val owner: String,
        val savedAt: Long,
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
    )

    @Serializable
    private data class CachedRooms(val owner: String, val savedAt: Long, val rooms: List<RoomSummary>)

    private fun fileFor(name: String): File = File(dir, sha256(name).take(32) + ".json")

    private fun write(file: File, text: String) {
        dir.mkdirs()
        // Write then rename, so a crash mid-write never leaves a torn file to load.
        val tmp = File(dir, file.name + ".tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }

    /** The cached room for this account, or null. A corrupt or foreign file is dropped. */
    fun loadRoom(sessionKey: String): RoomState? {
        val who = owner() ?: return null
        val file = fileFor("room:$sessionKey")
        if (!file.exists()) return null
        val cached = runCatching { CrewJson.decodeFromString(CachedRoom.serializer(), file.readText()) }.getOrNull()
        if (cached == null) {
            file.delete()
            return null
        }
        if (cached.owner != who) return null
        file.setLastModified(System.currentTimeMillis())
        return RoomState(
            session = cached.session,
            members = cached.members,
            turns = cached.turns,
            notes = cached.notes,
            decisions = cached.decisions,
            claims = cached.claims,
            commitments = cached.commitments,
            participants = cached.participants,
            workProductTurns = cached.workProductTurns,
            currentUserId = cached.currentUserId,
            cursor = cached.cursor,
        )
    }

    /** Saves a room that exists on the server, keeping its most recent turns, then trims the cache to [MAX_ROOMS]. */
    fun saveRoom(sessionKey: String, room: RoomState) {
        val who = owner() ?: return
        if (room.session == null) return // a draft room exists only on this phone until its first message
        val turns = room.turns.takeLast(MAX_TURNS)
        val cached = CachedRoom(
            owner = who,
            savedAt = System.currentTimeMillis(),
            session = room.session,
            members = room.members,
            turns = turns,
            notes = room.notes,
            decisions = room.decisions,
            claims = room.claims,
            commitments = room.commitments,
            participants = room.participants,
            workProductTurns = room.workProductTurns,
            currentUserId = room.currentUserId,
            // Only as far as the turns kept, so a delta never skips what was trimmed.
            cursor = turns.lastOrNull()?.id ?: 0,
        )
        write(fileFor("room:$sessionKey"), CrewJson.encodeToString(CachedRoom.serializer(), cached))
        trim()
    }

    fun loadRooms(): List<RoomSummary>? {
        val who = owner() ?: return null
        val file = fileFor("rooms")
        if (!file.exists()) return null
        val cached = runCatching { CrewJson.decodeFromString(CachedRooms.serializer(), file.readText()) }.getOrNull()
        return cached?.takeIf { it.owner == who }?.rooms
    }

    fun saveRooms(rooms: List<RoomSummary>) {
        val who = owner() ?: return
        write(fileFor("rooms"), CrewJson.encodeToString(CachedRooms.serializer(), CachedRooms(who, System.currentTimeMillis(), rooms)))
    }

    /** Sign-out: nothing of this account's rooms stays on the phone. */
    fun clear() {
        dir.listFiles()?.forEach { it.delete() }
    }

    /** Keeps the [MAX_ROOMS] most recently used rooms; the rooms list file is never the one evicted. */
    private fun trim() {
        val listFile = fileFor("rooms").name
        val rooms = dir.listFiles { f -> f.name.endsWith(".json") && f.name != listFile }.orEmpty()
        if (rooms.size <= MAX_ROOMS) return
        rooms.sortedByDescending { it.lastModified() }.drop(MAX_ROOMS).forEach { it.delete() }
    }

    companion object {
        const val MAX_ROOMS = 30
        const val MAX_TURNS = 200

        /** Who a cache entry belongs to: this server and this account. */
        fun ownerOf(serverUrl: String?, username: String?): String? =
            if (serverUrl.isNullOrBlank() || username.isNullOrBlank()) null else "$serverUrl|$username"

        private fun sha256(s: String): String =
            MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
