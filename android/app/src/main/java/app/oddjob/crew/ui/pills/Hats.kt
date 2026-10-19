package app.oddjob.crew.ui.pills

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.oddjob.crew.data.AgentPills
import app.oddjob.crew.data.AgentPills.Hat

/**
 * The agent hats of CrewAgentHat.tsx, as the same 24×24 shapes: every hat in a
 * three-quarter view facing left, the crown in the agent's accent, bands and
 * undersides at [TONE], and the brim knocked out around the crown so the two
 * stay apart at pill size.
 */
private const val TONE = 0.5f

/** Width of the knockout gap drawn around the crown, in 24-unit space. */
private const val GAP = 1.3f

private class Part(
    d: String,
    val tone: Boolean = false,
    /** Above zero, the part is a round-capped line of this width instead of a fill. */
    val stroke: Float = 0f,
    val evenOdd: Boolean = false,
    /** Degrees about ([px], [py]), like an SVG `rotate(deg px py)`. */
    val rotate: Float = 0f,
    val px: Float = 0f,
    val py: Float = 0f,
) {
    val path: Path = PathParser().parsePathString(d).toPath().also {
        if (evenOdd) it.fillType = PathFillType.EvenOdd
    }
}

private class HatShapes(val brim: List<Part>, val body: List<Part>)

/** An SVG `<ellipse>` as a path. */
private fun ellipse(cx: Float, cy: Float, rx: Float, ry: Float) =
    "M${cx - rx},${cy}a$rx,$ry 0 1 0 ${2 * rx},0a$rx,$ry 0 1 0 ${-2 * rx},0Z"

private fun circle(cx: Float, cy: Float, r: Float) = ellipse(cx, cy, r, r)

private val shapes: Map<Hat, HatShapes> = mapOf(
    Hat.Bowler to HatShapes(
        brim = listOf(Part(ellipse(12.2f, 17.4f, 9f, 2.9f), rotate = -8f, px = 12.2f, py = 17.4f)),
        body = listOf(
            Part("M6.6 13.9C6.4 8.6 8.7 5.4 12.4 5.4s5.6 3.1 5.3 7.9c-3.3 1.7-7.6 1.8-11.1.6Z"),
            Part("M6.6 14.6c3.4 1.2 7.8 1.1 11.1-.6l-.1 2.2c-3.3 1.7-7.7 1.8-10.9.6Z", tone = true),
        ),
    ),
    Hat.TopHat to HatShapes(
        brim = listOf(Part(ellipse(12.2f, 17.6f, 10f, 3.1f), rotate = -8f, px = 12.2f, py = 17.6f)),
        body = listOf(
            Part("M7.1 5.9l.35 7.2c2.8 1.1 6.3 1 9.3-.6l.35-7.3c-1.6 1.4-8.4 1.9-10-.7Z"),
            Part("M7.1 5.9c1.6 1.2 8.4.7 10-.7 0-1.1-10-.5-10 .7Z", tone = true),
            Part("M7.5 13.8c2.7 1.1 6.2 1 9.2-.6l-.2 3.4c-2.9 1.6-6.1 1.8-8.8.7Z", tone = true),
        ),
    ),
    Hat.Fedora to HatShapes(
        brim = listOf(Part(ellipse(12f, 16.6f, 11f, 3.3f), rotate = -11f, px = 12f, py = 16.6f)),
        body = listOf(
            Part("M7.4 13.1l.7-5.6c.3-1.2 1.3-1.5 2.1-.7 1.4 1 3.2-.3 4.9-.8 1.2-.3 1.8.5 1.9 1.7l.3 4.8c-3.1 1.6-6.9 1.8-9.9.6Z"),
            Part("M8.9 8.3l1.1-.2-.2 3-1.1.3Z", tone = true),
            Part("M7.35 13.8c3.1 1.1 6.9.9 10-.7l.1 2.5c-3.2 1.7-7.1 1.8-10.2.7Z", tone = true),
        ),
    ),
    Hat.FlatCap to HatShapes(
        brim = listOf(Part("M1.1 17.2c.4-1.6 3.4-2.4 6.8-2.1l.3 2.4c-2.7 1-6.3 1.2-7.1-.3Z")),
        body = listOf(
            Part("M5 15.2c.3-3 3.5-5.3 8.4-5.5 4.6-.2 8 1.3 8.3 3.9v1c-4.6 1.4-11.6 1.6-16.7.6Z"),
            Part(circle(12.6f, 9.8f, .8f)),
            Part("M5 15.9c5.1 1 12.1.8 16.7-.6v1.4c-4.6 1.5-11.6 1.7-16.7.7Z", tone = true),
        ),
    ),
    Hat.Beret to HatShapes(
        brim = listOf(Part("M6.4 15.3c3 1 8.2 1 11.2-.2l-.2 2.2c-2.8 1-8 1-10.8 0Z", tone = true)),
        body = listOf(
            Part("M2.6 12.4C2.4 9.4 6.6 7.1 12.4 7c5.8-.1 9.4 2 9.1 4.6-.3 2.4-4.2 3.8-9.3 3.9-5 .1-9.4-1.1-9.6-3.1Z"),
            Part("M11.8 7.1l-.7-2.3", stroke = 1.4f),
        ),
    ),
    Hat.Deerstalker to HatShapes(
        brim = listOf(
            Part("M.7 17.6c1.4-2 4.7-2.9 7.2-2.6v2.5c-2.5.6-5.8 1-7.2.1Z"),
            Part("M21.8 15.6c-1-1.1-2.7-1.4-4.2-1.3V16c1.5.3 3.2.3 4.2-.4Z"),
        ),
        body = listOf(
            Part("M6.7 14c0-4.4 2.4-7 5.6-7s5.4 2.6 5.4 6.7c-3.4 1.2-7.4 1.3-11 .3Z"),
            Part("M9.9 6.6c.8-1.2 1.8-1.1 2.4-.4.6-.7 1.6-.8 2.4.4-.9.5-1.8.5-2.4.1-.6.4-1.5.4-2.4-.1Z"),
            Part("M6.7 14.7c3.6 1 7.6.9 11-.3v1.8c-3.4 1.2-7.4 1.3-11 .3Z", tone = true),
            Part("M8.3 17l.5 3.2 2-2.8Z", tone = true),
        ),
    ),
    Hat.HardHat to HatShapes(
        brim = listOf(Part("M1.4 16.4c.4-1.4 3.4-1.9 6.4-1.6h13.4c.9 1.3-.4 2.7-2.9 3.1-4.6.7-9.4.7-13.6.2-2.2-.3-3.6-.9-3.3-1.7Z")),
        body = listOf(
            Part(
                "M5.2 14.6C5.2 10.1 8.3 7 12.3 7s6.8 3 6.8 7.3c-4.4 1.1-9.4 1.2-13.9.3Zm4.5-6.7c.6 2 .8 4.4.8 6.9l2.3.1c-.1-2.6.1-5 .5-7.2-1.3-.4-2.6-.3-3.6.2Z",
                evenOdd = true,
            ),
            Part("M9.7 7.9c1-.5 2.3-.6 3.6-.2-.4 2.2-.6 4.6-.5 7.2l-2.3-.1c0-2.5-.2-4.9-.8-6.9Z", tone = true),
        ),
    ),
    Hat.Mortarboard to HatShapes(
        brim = listOf(Part("M6.6 10.8v4c0 1.6 2.5 2.9 5.6 2.9s5.6-1.3 5.6-2.9v-4.4L13 13Z", tone = true)),
        body = listOf(
            Part("M10.9 3.6l11.5 3.9L13 12.6 1.6 8.3Z"),
            Part("M1.6 8.3L13 12.6l9.4-5.1v1L13 13.6 1.6 9.2Z", tone = true),
            Part("M21.2 8.4v5.4", stroke = 1.2f),
            Part("M20.5 13.6h1.4l.5 3.4H20Z"),
        ),
    ),
    Hat.Cowboy to HatShapes(
        brim = listOf(Part("M1.4 11.6c.6 2.8 3.2 4.4 5.6 4.7 3.3.4 6.7.4 10 0 2.4-.3 4.7-1.4 5.6-3.4.6 2.9-1.6 5.9-6.8 6.6-2.7.4-5.3.4-8 .1-5.3-.6-7.3-4.4-6.4-8Z")),
        body = listOf(
            Part("M7.4 13l.7-5.4c.3-1.5 1.7-1.8 2.7-.9l1.1.9 1.2-1c1.1-.9 2.7-.8 3.1.7l.6 5.2c-3 1.4-6.6 1.5-9.4.5Z"),
            Part("M9 7.9l.9.1-.2 2.8-.9.2Z", tone = true),
            Part("M7.3 13.7c2.8 1 6.4.9 9.5-.5l.1 1.9c-3.1 1.5-6.8 1.6-9.7.5Z", tone = true),
        ),
    ),
)

private fun DrawScope.draw(part: Part, color: Color, blendMode: BlendMode = BlendMode.SrcOver, gap: Float = 0f) {
    val alpha = if (part.tone && blendMode == BlendMode.SrcOver) TONE else 1f
    rotate(part.rotate, Offset(part.px, part.py)) {
        if (part.stroke > 0f) {
            drawPath(part.path, color, alpha, Stroke(part.stroke, cap = StrokeCap.Round), blendMode = blendMode)
        } else {
            drawPath(part.path, color, alpha, Fill, blendMode = blendMode)
            if (gap > 0f) {
                drawPath(part.path, color, alpha, Stroke(gap, join = StrokeJoin.Round), blendMode = blendMode)
            }
        }
    }
}

/** The hat [name] wears (see [AgentPills.hatFor]), drawn in [tint]. Decorative unless [label] is given. */
@Composable
fun AgentHat(
    name: String,
    personaType: String? = null,
    size: Dp = 24.dp,
    tint: Color = accentFor(name),
    label: String? = null,
    modifier: Modifier = Modifier,
) {
    val hat = shapes.getValue(AgentPills.hatFor(name, personaType))
    Canvas(
        modifier
            .size(size)
            // Offscreen, so the knockout clears only the brim and not what is behind the hat.
            .graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)
            .then(if (label != null) Modifier.semantics { contentDescription = label } else Modifier),
    ) {
        scale(this.size.width / 24f, this.size.height / 24f, pivot = Offset.Zero) {
            hat.brim.forEach { draw(it, tint) }
            hat.body.forEach { draw(it, tint, BlendMode.Clear, gap = GAP) }
            hat.body.forEach { draw(it, tint) }
        }
    }
}
