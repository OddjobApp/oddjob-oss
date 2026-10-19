package app.oddjob.crew.ui.pills

import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.unit.em
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import app.oddjob.crew.data.AgentCard
import app.oddjob.crew.data.AgentPills
import app.oddjob.crew.ui.theme.OddjobColors
import app.oddjob.crew.ui.theme.OddjobIcons

/** crew-style-helpers.ts ACCENTS: sky, violet, emerald, amber, rose, cyan (Tailwind 500). */
val Accents = listOf(
    Color(0xFF0EA5E9), Color(0xFF8B5CF6), Color(0xFF10B981),
    Color(0xFFF59E0B), Color(0xFFF43F5E), Color(0xFF06B6D4),
)

fun accentFor(name: String): Color = Accents[AgentPills.accentIndex(name)]

/** The style of an `@Name` pill inside running text. */
fun pillStyle(name: String): SpanStyle {
    val accent = accentFor(name)
    return SpanStyle(color = accent, background = accent.copy(alpha = 0.15f), fontWeight = FontWeight.Medium)
}

/** Appends [text] with any `@Name` of [names] drawn as pills, on top of [base]. */
fun AnnotatedString.Builder.appendWithPills(text: String, names: List<String>, base: SpanStyle = SpanStyle()) {
    for (part in AgentPills.split(text, names)) {
        when (part) {
            is AgentPills.Part.Text -> withStyle(base) { append(part.text) }
            is AgentPills.Part.Pill -> withStyle(base.merge(pillStyle(part.name))) {
                append(" ")
                appendInlineContent(hatInlineId(part.name), " ")
                append("@${part.name} ")
            }
        }
    }
}

private fun hatInlineId(name: String) = "agent-hat:$name"

/**
 * The hats [appendWithPills] puts in front of each `@Name`. Pass it as the
 * `inlineContent` of the Text that shows the string; without it the pill still
 * reads, minus the hat.
 */
fun pillInlineContent(names: List<String>): Map<String, InlineTextContent> =
    names.filter { it.isNotBlank() }.associate { name ->
        hatInlineId(name) to InlineTextContent(Placeholder(1.2.em, 1.2.em, PlaceholderVerticalAlign.TextCenter)) {
            // A span background does not paint inline content, so the hat carries the pill's tint itself.
            Box(
                Modifier.fillMaxSize().background(accentFor(name).copy(alpha = 0.15f)).padding(1.dp),
                contentAlignment = Alignment.Center,
            ) {
                AgentHat(name, modifier = Modifier.fillMaxSize())
            }
        }
    }

/** The "Squad Agent Pills" picker shown above the composer while typing `@nam…`. */
@Composable
fun AgentPillPicker(agents: List<AgentCard>, onPick: (AgentCard) -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 6.dp,
        shadowElevation = 6.dp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
    ) {
        Column {
            Row(
                Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(Icons.Default.Person, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
                Text(
                    "SQUAD AGENT PILLS",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            HorizontalDivider()
            LazyColumn(Modifier.heightIn(max = 240.dp)) {
                items(agents, key = { it.id }) { agent ->
                    PickerRow(agent) { onPick(agent) }
                }
            }
        }
    }
}

@Composable
private fun PickerRow(agent: AgentCard, onClick: () -> Unit) {
    val accent = accentFor(agent.name)
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier.size(32.dp).background(accent.copy(alpha = 0.15f), RoundedCornerShape(6.dp)),
            contentAlignment = Alignment.Center,
        ) {
            AgentHat(agent.name, agent.personaType, size = 22.dp, tint = accent)
        }
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("@${agent.name}", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                (agent.soulArchetype ?: agent.personaType)?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier
                            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f), RoundedCornerShape(50))
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
            Text(
                buildString {
                    append(agent.legend ?: agent.description ?: "Autonomous agent")
                    if (agent.capabilities.isNotEmpty()) append(" · " + agent.capabilities.take(3).joinToString(", "))
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** One agent's round avatar: its hat, in its accent. */
@Composable
fun AgentAvatar(agent: AgentCard, size: androidx.compose.ui.unit.Dp, ring: Color = MaterialTheme.colorScheme.background) {
    val accent = accentFor(agent.name)
    Box(
        Modifier
            .size(size)
            .background(ring, RoundedCornerShape(50))
            .padding(2.dp)
            .background(Color(0xFF0F172A), RoundedCornerShape(50))
            .background(accent.copy(alpha = 0.22f), RoundedCornerShape(50)),
        contentAlignment = Alignment.Center,
    ) {
        AgentHat(agent.name, agent.personaType, size = size * 0.7f, tint = accent)
    }
}

/**
 * The squad in one slim row: overlapping agent avatars and the head count.
 * Replaces the site's two-row pill strip, which cost a phone a fifth of its
 * screen on every room. Tap to see and mention the whole squad.
 */
@Composable
fun SquadBar(agents: List<AgentCard>, humans: Int, totalAgents: Int, onOpen: () -> Unit) {
    if (totalAgents == 0 && humans == 0) return
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val shown = agents.take(4)
        Box(Modifier.size(width = (28 + 18 * (shown.size - 1).coerceAtLeast(0)).dp, height = 28.dp)) {
            shown.forEachIndexed { i, agent ->
                Box(Modifier.padding(start = (18 * i).dp)) { AgentAvatar(agent, 28.dp) }
            }
        }
        if (agents.size > shown.size) {
            Text(
                "+${agents.size - shown.size}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 6.dp),
            )
        }
        Text(
            "$humans ${if (humans == 1) "Human" else "Humans"} · $totalAgents ${if (totalAgents == 1) "Agent" else "Agents"}",
            style = MaterialTheme.typography.labelMedium,
            color = Color(0xFFC4B5FD),
            modifier = Modifier.padding(start = 10.dp).weight(1f),
        )
        Icon(
            Icons.Default.KeyboardArrowDown,
            "Show squad",
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
    }
}

/**
 * The whole squad. The checkbox selects or deselects an agent for this person
 * (only selected agents answer); tapping the agent mentions it in the composer.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun SquadSheet(
    agents: List<AgentCard>,
    humans: List<String>,
    hiddenStudioAgents: Int,
    selected: List<Int>,
    onToggle: (AgentCard) -> Unit,
    onAddAgents: () -> Unit,
    onMention: (AgentCard) -> Unit,
    onDismiss: () -> Unit,
) {
    androidx.compose.material3.ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(bottom = 24.dp)) {
            Row(
                Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(OddjobIcons.Users, null, tint = OddjobColors.Violet, modifier = Modifier.size(18.dp))
                Text("Active Squad", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                androidx.compose.material3.TextButton(onClick = { onDismiss(); onAddAgents() }) { Text("Add agents") }
            }
            Text(
                "${agents.count { it.id in selected }} of ${agents.size} selected. Only selected agents answer your messages; tap a name to mention it.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
            if (agents.none { it.id in selected }) {
                Text(
                    "No agents selected: the crew will recruit specialists for your next message.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                )
            }
            if (humans.isNotEmpty()) {
                Text(
                    humans.joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                )
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            agents.forEach { agent ->
                val on = agent.id in selected
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 20.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Row(
                        Modifier
                            .weight(1f)
                            .clickable(enabled = on) { onMention(agent); onDismiss() }
                            .padding(vertical = 6.dp)
                            .alpha(if (on) 1f else 0.45f),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        AgentAvatar(agent, 36.dp, ring = Color.Transparent)
                        Column(Modifier.weight(1f)) {
                            Text(agent.name, style = MaterialTheme.typography.labelLarge)
                            (agent.soulArchetype ?: agent.personaType)?.let {
                                Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    androidx.compose.material3.Checkbox(
                        checked = on,
                        onCheckedChange = { onToggle(agent) },
                        modifier = Modifier.semantics { contentDescription = (if (on) "Deselect " else "Select ") + agent.name },
                    )
                }
            }
            if (hiddenStudioAgents > 0) {
                Text(
                    "+$hiddenStudioAgents studio ${if (hiddenStudioAgents == 1) "agent" else "agents"}, available in Oddjob on desktop",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                )
            }
        }
    }
}
