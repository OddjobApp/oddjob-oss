package app.oddjob.crew.ui.theme

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The brand marks the web draws inline (GoogleWorkspaceIcon.tsx), as the same
 * 24×24 paths. A few marks carry a letter ("31", "a", "W"); vectors cannot hold
 * text, so [WorkspaceIcon] lays it over the drawing.
 */
object WorkspaceIcons {
    private class Shape(val d: String, val fill: Color? = null, val stroke: Color? = null, val strokeWidth: Float = 0f)

    private fun vector(name: String, vararg shapes: Shape): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
            shapes.forEach { s ->
                addPath(
                    pathData = PathParser().parsePathString(s.d).toNodes(),
                    fill = s.fill?.let(::SolidColor),
                    stroke = s.stroke?.let(::SolidColor),
                    strokeLineWidth = s.strokeWidth,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()

    /** A rounded rect as a path, for the marks the web draws with <rect rx>. */
    private fun roundRect(x: Float, y: Float, w: Float, h: Float, r: Float) =
        "M${x + r},${y}h${w - 2 * r}a$r,$r 0 0 1 $r,$r" + "v${h - 2 * r}a$r,$r 0 0 1 -$r,$r" +
            "h-${w - 2 * r}a$r,$r 0 0 1 -$r,-$r" + "v-${h - 2 * r}a$r,$r 0 0 1 $r,-${r}z"

    val Gmail = vector(
        "Gmail",
        Shape("M2 6.5 6 9.5V20H3a1 1 0 0 1-1-1z", Color(0xFF4285F4)),
        Shape("m18 9.5 4-3V19a1 1 0 0 1-1 1h-3z", Color(0xFF34A853)),
        Shape("M6 5 12 9.5 18 5v4.5L12 14 6 9.5z", Color(0xFFEA4335)),
        Shape("M2 6.5V5a2 2 0 0 1 3.2-1.6L6 4v5.5z", Color(0xFFC5221F)),
        Shape("M18 4l.8-.6A2 2 0 0 1 22 5v1.5l-4 3z", Color(0xFFFBBC04)),
    )

    val Calendar = vector(
        "Calendar",
        Shape("M3 3h18v4H7v14H3z", Color(0xFF4285F4)),
        Shape("M17 7h4v10h-4z", Color(0xFF34A853)),
        Shape("M7 17h10v4H7z", Color(0xFFFBBC04)),
        Shape("M17 17h4l-4 4z", Color(0xFFEA4335)),
        Shape("M7 7h10v10H7z", Color.White),
    )

    val Document = vector(
        "Document",
        Shape("M5 2h9l5 5v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z", Color(0xFF4285F4)),
        Shape("M14 2v5h5z", Color(0xFFA1C2FA)),
        Shape("M7 11h9M7 14h9M7 17h7", stroke = Color.White, strokeWidth = 1.4f),
    )

    val YouTube = vector(
        "YouTube",
        Shape(roundRect(1f, 4f, 22f, 16f, 5f), Color(0xFFFF0000)),
        Shape("m10 8 6 4-6 4z", Color.White),
    )

    val Amazon = vector(
        "Amazon",
        Shape(roundRect(1f, 1f, 22f, 22f, 5f), Color(0xFFFF9900)),
        Shape("M5 15.5c4 3.5 10 3.5 14 0", stroke = Color.White, strokeWidth = 1.6f),
    )

    val FlightHub = vector(
        "FlightHub",
        Shape(roundRect(1f, 1f, 22f, 22f, 5f), Color(0xFF003D7C)),
        Shape("M21 15.9v-1.9l-7.5-4.7V4.1a1.4 1.4 0 0 0-2.8 0v5.2L3 14v1.9l7.6-2.4v4.9l-2.1 1.6v1.5l3.6-1 3.6 1v-1.5l-2.1-1.6v-4.9z", Color.White),
    )

    val Word = vector(
        "Word",
        Shape("M8 2h13v20H8z", Color(0xFF185ABD)),
        Shape("M8 2h13v6H8z", Color(0xFF41A5EE)),
        Shape("M8 8h13v7H8z", Color(0xFF2B7CD3)),
        Shape("M1 5h13v14H1z", Color(0xFF103F91)),
    )

    /** Granola's mark: a lime tile with a dark spiral. */
    val Granola = vector(
        "Granola",
        Shape(roundRect(1f, 1f, 22f, 22f, 6f), Color(0xFFB7D43B)),
        Shape("M17.5 8.2c-1.1-2.4-4.5-3.2-7.1-1.9-2.8 1.4-4 4.8-2.4 7.4 1.4 2.3 4.5 3.2 6.8 1.8 1.8-1.1 2.5-3.3 1.4-4.9-.9-1.3-2.8-1.8-4.1-.8-1 .7-1.3 2-.6 2.9.5.7 1.5.9 2.1.4", stroke = Color(0xFF17210D), strokeWidth = 2f),
    )

    /** The web's QuickBooks mark: a green disc; "QB" is laid over it. */
    val QuickBooks = vector("QuickBooks", Shape("M12 1a11 11 0 1 0 0.001 0z", Color(0xFF2CA01C)))

    /** lucide `copy`, tinted like any icon. */
    val Copy = vector(
        "Copy",
        Shape(roundRect(8f, 8f, 14f, 14f, 2f), stroke = Color.Black, strokeWidth = 2f),
        Shape("M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2", stroke = Color.Black, strokeWidth = 2f),
    )
}

/** The mark for a result item: platform first, then Google's kind (email, calendar, else a doc). */
@Composable
fun WorkspaceIcon(kind: String, platform: String? = null, size: Dp = 18.dp, modifier: Modifier = Modifier) {
    val (vector, label, overlay) = when {
        platform == "granola" -> Triple(WorkspaceIcons.Granola, "Granola", null)
        platform == "youtube" -> Triple(WorkspaceIcons.YouTube, "YouTube", null)
        platform == "amazon" -> Triple(WorkspaceIcons.Amazon, "Amazon", Overlay("a", Color.White, 0.46f, -0.08f))
        platform == "flighthub" -> Triple(WorkspaceIcons.FlightHub, "FlightHub", null)
        platform == "quickbooks" -> Triple(WorkspaceIcons.QuickBooks, "QuickBooks", Overlay("QB", Color.White, 0.42f, 0.0f))
        platform == "microsoft365" -> Triple(WorkspaceIcons.Word, "Microsoft Word", Overlay("W", Color.White, 0.36f, 0.12f, offsetX = -0.19f))
        kind == "email" -> Triple(WorkspaceIcons.Gmail, "Gmail", null)
        kind == "calendar" -> Triple(WorkspaceIcons.Calendar, "Google Calendar", Overlay("31", Color(0xFF4285F4), 0.29f, 0.0f))
        else -> Triple(WorkspaceIcons.Document, "Google Docs", null)
    }
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Image(vector, label, Modifier.size(size))
        overlay?.let {
            Text(
                it.text,
                style = TextStyle(color = it.color, fontWeight = FontWeight.Bold, fontSize = (size.value * it.scale).sp, lineHeight = (size.value * it.scale).sp),
                modifier = Modifier.align(Alignment.Center).offset(size * it.offsetX, size * it.offsetY),
            )
        }
    }
}

private data class Overlay(val text: String, val color: Color, val scale: Float, val offsetY: Float, val offsetX: Float = 0f)

