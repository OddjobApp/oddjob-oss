package app.oddjob.crew.data

/**
 * Which agents answer this person in a room: the web's per-person "active
 * agents" (AgentChatPanel's selectedIds). The selection travels with every
 * message as `agentCardIds`, which seats exactly those agents for the round,
 * and is saved per person per room through PUT /:key/active-agents, so the web
 * and the phone open the room with the same choice.
 */
object AgentSelection {
    /**
     * The selection in force: one made on this phone, else the one saved for
     * this person (dropping agents the org no longer offers), else the room's
     * current roster.
     */
    fun resolve(explicit: List<Int>?, room: RoomState, available: List<AgentCard>?): List<Int> {
        explicit?.let { return it }
        val saved = room.currentUserId?.let { room.session?.memory?.activeAgentSelections?.get(it) }
        if (saved != null) {
            val offered = available?.map { it.id }?.toSet()
            return if (offered == null) saved else saved.filter { it in offered }
        }
        return room.members.map { it.id }
    }

    fun toggle(current: List<Int>, id: Int): List<Int> = if (id in current) current - id else current + id

    /**
     * The agents the squad sheet lists: the room's roster and anyone selected
     * from the org's cards, studio agents left out (no studios on mobile).
     */
    fun pool(room: RoomState, available: List<AgentCard>?, selected: List<Int>): List<AgentCard> {
        val byId = LinkedHashMap<Int, AgentCard>()
        room.members.forEach { byId[it.id] = it }
        available.orEmpty().filter { it.id in selected }.forEach { byId.putIfAbsent(it.id, it) }
        return byId.values.filterNot(AgentPills::isStudioAgent)
    }
}
