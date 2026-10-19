package app.oddjob.crew.ui.room

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.oddjob.crew.data.CrewText
import app.oddjob.crew.data.CrewTurn
import app.oddjob.crew.data.ToolUse
import app.oddjob.crew.data.TurnDisplay
import app.oddjob.crew.ui.cards.CopyButton
import app.oddjob.crew.ui.cards.ProviderErrorCard
import app.oddjob.crew.ui.cards.TurnCardActions
import app.oddjob.crew.ui.cards.TurnCards
import app.oddjob.crew.ui.theme.WorkspaceIcon
import androidx.compose.runtime.remember
import androidx.compose.ui.text.buildAnnotatedString
import app.oddjob.crew.ui.cards.TurnArtifacts
import app.oddjob.crew.ui.pills.AgentHat
import app.oddjob.crew.ui.pills.appendWithPills
import app.oddjob.crew.ui.pills.pillInlineContent
import app.oddjob.crew.ui.markdown.MarkdownText
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val timeFormat = DateTimeFormatter.ofPattern("HH:mm")

internal fun formatTime(iso: String?): String? = iso?.let {
    runCatching { OffsetDateTime.parse(it).atZoneSameInstant(ZoneId.systemDefault()).format(timeFormat) }.getOrNull()
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TurnItem(
    turn: CrewTurn,
    isMine: Boolean,
    resolveUrl: (String) -> String,
    laterUserTurns: List<String>,
    pillNames: List<String>,
    showDetails: Boolean,
    actions: TurnCardActions,
) {
    val isUser = turn.speakerType == "user"
    val isSupervisor = turn.speakerType == "supervisor"
    val container = when {
        isMine -> MaterialTheme.colorScheme.primaryContainer
        isUser -> MaterialTheme.colorScheme.secondaryContainer
        isSupervisor -> MaterialTheme.colorScheme.tertiaryContainer
        else -> MaterialTheme.colorScheme.surfaceContainerHigh
    }
    val onContainer = when {
        isMine -> MaterialTheme.colorScheme.onPrimaryContainer
        isUser -> MaterialTheme.colorScheme.onSecondaryContainer
        isSupervisor -> MaterialTheme.colorScheme.onTertiaryContainer
        else -> MaterialTheme.colorScheme.onSurface
    }

    Column(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalAlignment = if (isMine) Alignment.End else Alignment.Start,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            if (!isUser && !isSupervisor) AgentHat(turn.speakerName, size = 18.dp)
            Text(
                if (isSupervisor) "${turn.speakerName} · supervisor" else turn.speakerName,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
            formatTime(turn.createdAt)?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (!isUser) CopyButton(remember(turn) { copyText(turn) }, "Copy response")
        }
        Surface(
            color = container,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.padding(top = 2.dp).widthIn(max = 560.dp),
        ) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val providerError = remember(turn.content) { if (isSupervisor) CrewText.providerError(turn.content) else null }
                if (isUser) {
                    // Items selected as context show as chips; the JSON the agents read stays hidden.
                    val scope = remember(turn.content) { CrewText.splitWorkspaceContext(turn.content) }
                    if (scope.labels.isNotEmpty()) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            scope.labels.forEachIndexed { i, label -> ContextChip(label, scope.kinds.getOrElse(i) { "document" }) }
                        }
                    }
                    Text(
                        // Form and stage answers read as a summary; the JSON stays in the stored turn for the agents.
                        remember(scope.message, pillNames) {
                            buildAnnotatedString { appendWithPills(TurnDisplay.summary(scope.message) ?: scope.message, pillNames) }
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = onContainer,
                        inlineContent = remember(pillNames) { pillInlineContent(pillNames) },
                    )
                } else if (providerError != null) {
                    ProviderErrorCard(providerError)
                } else {
                    MarkdownText(turn.content, color = onContainer, resolveUrl = resolveUrl, pillNames = pillNames)
                }
                if (showDetails && turn.toolsUsed.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        turn.toolsUsed.forEach { ToolChip(it) }
                    }
                }
                if (turn.artifacts.isNotEmpty()) {
                    TurnArtifacts(
                        turnId = turn.id,
                        artifacts = turn.artifacts,
                        laterUserTurns = laterUserTurns,
                        actions = actions,
                    )
                }
            }
        }
        // A fallback is always shown: a degraded answer must not pass as the requested model's.
        modelLine(turn)?.takeIf { showDetails || turn.wasFallback == true }?.let {
            Text(
                it,
                style = MaterialTheme.typography.labelSmall,
                color = if (turn.wasFallback == true) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp, start = 4.dp),
            )
        }
    }
}

/** The turn as text for the clipboard: its prose (or provider error) and what its cards show. */
internal fun copyText(turn: CrewTurn): String {
    val error = if (turn.speakerType == "supervisor") CrewText.providerError(turn.content) else null
    val prose = error?.let { "${it.title}\n\n${it.message}\n\n${it.nextStep}" } ?: turn.content
    return (listOf(prose) + turn.artifacts.mapNotNull(TurnCards::copyText)).filter { it.isNotBlank() }.joinToString("\n\n")
}

@Composable
private fun ContextChip(label: String, kind: String) {
    Surface(shape = RoundedCornerShape(6.dp), color = MaterialTheme.colorScheme.surface) {
        Row(
            Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            WorkspaceIcon(kind, size = 14.dp)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

/** What actually answered. A failover is called out, so a degraded turn is not mistaken for the requested model. */
internal fun modelLine(turn: CrewTurn): String? {
    val model = turn.servedModel ?: return null
    return buildString {
        append(model)
        turn.latencyMs?.let { append(" · ${"%.1f".format(it / 1000.0)}s") }
        if (turn.wasFallback == true) append(" · fallback model")
    }
}

@Composable
private fun ToolChip(tool: ToolUse) {
    val ok = tool.ok
    Surface(
        shape = RoundedCornerShape(50),
        color = if (ok) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.errorContainer,
    ) {
        Text(
            buildString {
                append(if (ok) "✓ " else "✗ ")
                append(tool.name)
                tool.ms?.let { append(" ${it}ms") }
            },
            style = MaterialTheme.typography.labelSmall,
            color = if (ok) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onErrorContainer,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}
