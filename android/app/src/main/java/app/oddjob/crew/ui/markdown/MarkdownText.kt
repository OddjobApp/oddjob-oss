package app.oddjob.crew.ui.markdown

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import app.oddjob.crew.ui.pills.appendWithPills
import app.oddjob.crew.ui.pills.pillInlineContent

/** Renders an agent turn's Markdown. [resolveUrl] turns a server-relative link into an absolute one. */
@Composable
fun MarkdownText(
    source: String,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurface,
    resolveUrl: (String) -> String = { it },
    /** Names drawn as Agent Pills where the text mentions them as `@Name`. */
    pillNames: List<String> = emptyList(),
) {
    val blocks = remember(source) { Markdown.parse(source) }
    val codeBackground = MaterialTheme.colorScheme.surfaceVariant
    val linkColor = MaterialTheme.colorScheme.primary
    val body = MaterialTheme.typography.bodyMedium.copy(color = color)
    val hats = remember(pillNames) { pillInlineContent(pillNames) }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (block in blocks) {
            when (block) {
                is MdBlock.Heading -> Text(
                    annotate(block.spans, codeBackground, linkColor, resolveUrl, pillNames),
                    style = when (block.level) {
                        1 -> MaterialTheme.typography.titleLarge
                        2 -> MaterialTheme.typography.titleMedium
                        else -> MaterialTheme.typography.titleSmall
                    }.copy(color = color),
                    inlineContent = hats,
                )
                is MdBlock.Paragraph -> Text(annotate(block.spans, codeBackground, linkColor, resolveUrl, pillNames), style = body, inlineContent = hats)
                is MdBlock.ListItem -> Row(Modifier.padding(start = (block.depth * 12).dp)) {
                    Text(block.marker, style = body, modifier = Modifier.width(22.dp))
                    Text(annotate(block.spans, codeBackground, linkColor, resolveUrl, pillNames), style = body, inlineContent = hats)
                }
                is MdBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
                    Box(
                        Modifier
                            .width(3.dp)
                            .fillMaxHeight()
                            .background(MaterialTheme.colorScheme.outlineVariant)
                    )
                    Text(
                        annotate(block.spans, codeBackground, linkColor, resolveUrl, pillNames),
                        style = body.copy(fontStyle = FontStyle.Italic),
                        inlineContent = hats,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
                is MdBlock.Code -> Box(
                    Modifier
                        .fillMaxWidth()
                        .background(codeBackground, RoundedCornerShape(6.dp))
                        .horizontalScroll(rememberScrollState())
                        .padding(8.dp)
                ) {
                    Text(
                        block.text,
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

private fun annotate(
    spans: List<MdSpan>,
    codeBackground: Color,
    linkColor: Color,
    resolveUrl: (String) -> String,
    pillNames: List<String>,
): AnnotatedString = buildAnnotatedString {
    for (span in spans) {
        val style = SpanStyle(
            fontWeight = if (span.bold) FontWeight.SemiBold else null,
            fontStyle = if (span.italic) FontStyle.Italic else null,
            fontFamily = if (span.code) FontFamily.Monospace else null,
            background = if (span.code) codeBackground else Color.Unspecified,
        )
        if (span.url != null) {
            withLink(
                LinkAnnotation.Url(
                    resolveUrl(span.url),
                    TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)),
                )
            ) { withStyle(style) { append(span.text) } }
        } else if (span.code) {
            withStyle(style) { append(span.text) }
        } else {
            appendWithPills(span.text, pillNames, style)
        }
    }
}
