package app.oddjob.crew.data

/**
 * Agent Pills: `@Name` mentions. Mirrors CrewComposer.tsx (the "Squad Agent
 * Pills" picker) and renderPillMentions/accentFor in TurnRow.tsx and
 * crew-style-helpers.ts.
 */
object AgentPills {

    /**
     * Studio agents are left out of the mobile picker: the app has no studios.
     * Decided from what the agent can do, not its name: an agent whose tools
     * mount a studio (`mount_media_studio`, …) or author in Scribe (`scribe_*`)
     * belongs to that studio. `mount_builder_pod` is not a studio mount, so
     * Copilot stays.
     */
    fun isStudioAgent(card: AgentCard): Boolean =
        card.tools.any { (it.startsWith("mount_") && it.endsWith("_studio")) || it.startsWith("scribe_") }

    data class Mention(val query: String, val start: Int)

    private val queryChars = Regex("^[a-zA-Z0-9_ -]+$")

    private fun matchesQuery(a: AgentCard, q: String): Boolean =
        a.name.lowercase().contains(q) ||
            a.soulArchetype?.lowercase()?.contains(q) == true ||
            a.personaType?.lowercase()?.contains(q) == true ||
            a.capabilities.any { it.lowercase().contains(q) }

    /**
     * updateMentionFromInput: an `@` at the start or after whitespace, followed by
     * at least three name characters that match some agent.
     */
    fun detect(text: String, cursor: Int, agents: List<AgentCard>): Mention? {
        val before = text.substring(0, cursor.coerceIn(0, text.length))
        val at = before.lastIndexOf('@')
        if (at == -1 || (at != 0 && !before[at - 1].isWhitespace())) return null
        val candidate = before.substring(at + 1)
        if (candidate.length < 3 || !queryChars.matches(candidate)) return null
        val q = candidate.lowercase()
        return if (agents.any { matchesQuery(it, q) }) Mention(candidate, at) else null
    }

    /** mentionMatches: name-prefix hits first, then alphabetical, at most eight. */
    fun matches(mention: Mention, agents: List<AgentCard>): List<AgentCard> {
        val q = mention.query.lowercase().trim()
        if (q.isEmpty()) return agents.take(8)
        return agents.filter { matchesQuery(it, q) }
            .sortedWith(
                compareBy<AgentCard> { if (it.name.lowercase().startsWith(q)) 0 else 1 }
                    .thenComparator { a, b -> a.name.compareTo(b.name, ignoreCase = true) },
            )
            .take(8)
    }

    /** insertMention: returns the new text and where the caret goes. */
    fun insert(text: String, mention: Mention, agent: AgentCard): Pair<String, Int> {
        val before = text.substring(0, mention.start)
        val after = text.substring((mention.start + 1 + mention.query.length).coerceAtMost(text.length)).trimStart()
        val inserted = "$before@${agent.name} "
        return (inserted + after) to inserted.length
    }

    sealed interface Part {
        data class Text(val text: String) : Part
        data class Pill(val name: String) : Part
    }

    /**
     * renderPillMentions: `@Name` for a known name, preceded by start, whitespace,
     * `(` or `[`, and followed by end, whitespace or punctuation. Longest names
     * first, so "@Data Analyst" wins over "@Data".
     */
    fun split(text: String, knownNames: List<String>): List<Part> {
        if (!text.contains('@')) return listOf(Part.Text(text))
        val names = knownNames.filter { it.isNotBlank() }.sortedByDescending { it.length }
        if (names.isEmpty()) return listOf(Part.Text(text))
        val pattern = Regex("(?<=^|[\\s(\\[])@(" + names.joinToString("|") { Regex.escape(it) } + ")(?=[\\s,.:;!?)\\]]|$)")
        val parts = mutableListOf<Part>()
        var last = 0
        for (m in pattern.findAll(text)) {
            if (m.range.first > last) parts += Part.Text(text.substring(last, m.range.first))
            parts += Part.Pill(m.groupValues[1])
            last = m.range.last + 1
        }
        if (last < text.length) parts += Part.Text(text.substring(last))
        return parts.ifEmpty { listOf(Part.Text(text)) }
    }

    /** CrewAgentHat.tsx HATS: one hat per kind of work. */
    enum class Hat { Bowler, TopHat, Fedora, FlatCap, Beret, Deerstalker, HardHat, Mortarboard, Cowboy }

    /** hatFor's rules, in order: first match wins, so the specific trades come first. */
    private val hatRules: List<Pair<Regex, Hat>> = listOf(
        Regex("copilot") to Hat.Bowler,
        Regex("trainer|wrangl") to Hat.Cowboy,
        Regex("secur|audit|complian|legal|counsel|regulat|risk|chaos") to Hat.Deerstalker,
        Regex("research|knowledge|literature|documentation|teach|tutor|evaluat|coach") to Hat.Mortarboard,
        Regex("""creative|artist|writer|media|design|ux\b|marketing|content|seo|brand|visual""") to Hat.Beret,
        Regex("""coder|develop|engineer|devops|sre\b|reliab|backend|frontend|mobile|database|sql|deploy|release|\bqa\b|test|code|repositor|pull request|technical|observab|browser""") to Hat.HardHat,
        Regex("analyst|financ|tax|treasur|account|sales|deal|forecast|reconcil|procure|vendor") to Hat.Fedora,
        Regex("""dispatch|support|ticket|customer|onboard|logistic|fleet|\bhr\b|human resources|coordinator|service""") to Hat.FlatCap,
        Regex("architect|director|producer|manager|lead|strateg|supervisor|master|orchestrat|commander") to Hat.TopHat,
    )

    /**
     * hatFor: the hat an agent wears, from its name and persona type. Keyed on
     * the name alone otherwise, because a turn and an `@Name` pill only know
     * the name; an unmatched name picks a hat by the same hash as [accentIndex].
     */
    fun hatFor(name: String, personaType: String? = null): Hat {
        val key = "$name ${personaType.orEmpty()}".lowercase().replace('-', ' ').replace('_', ' ')
        hatRules.firstOrNull { it.first.containsMatchIn(key) }?.let { return it.second }
        var hash = 0
        for (c in name) hash = hash * 31 + c.code
        return Hat.entries[Math.floorMod(kotlin.math.abs(hash.toLong()), Hat.entries.size.toLong()).toInt()]
    }

    /** accentFor: a stable accent per name. Index into sky, violet, emerald, amber, rose, cyan. */
    fun accentIndex(name: String): Int {
        var hash = 0
        for (c in name) hash = hash * 31 + c.code // Int overflow wraps like JS `| 0`.
        return Math.floorMod(kotlin.math.abs(hash.toLong()), 6L).toInt()
    }
}
