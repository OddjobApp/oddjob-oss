package app.oddjob.crew.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** Lucide glyphs the website uses, drawn as the same 24×24, 2px-stroke outlines. */
object OddjobIcons {
    private fun lucide(name: String, block: ImageVector.Builder.() -> Unit): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply(block).build()

    private fun ImageVector.Builder.stroke(d: androidx.compose.ui.graphics.vector.PathBuilder.() -> Unit) {
        path(
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 2f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
            pathBuilder = d,
        )
    }

    /**
     * The agent glyph: a filled robot head (Material `smart_toy`, Apache-2.0),
     * used for every agent in pills, the picker and tiles.
     */
    val RobotHead: ImageVector = ImageVector.Builder("RobotHead", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(
            pathData = PathParser().parsePathString(
                "M20,9V7c0-1.1-0.9-2-2-2h-3c0-1.66-1.34-3-3-3S9,3.34,9,5H6C4.9,5,4,5.9,4,7v2c-1.66,0-3,1.34-3,3" +
                    "s1.34,3,3,3v4c0,1.1,0.9,2,2,2h12c1.1,0,2-0.9,2-2v-4c1.66,0,3-1.34,3-3S21.66,9,20,9z" +
                    "M7.5,11.5C7.5,10.67,8.17,10,9,10s1.5,0.67,1.5,1.5S9.83,13,9,13S7.5,12.33,7.5,11.5z" +
                    "M16,17H8v-2h8V17z" +
                    "M15,13c-0.83,0-1.5-0.67-1.5-1.5S14.17,10,15,10s1.5,0.67,1.5,1.5S15.83,13,15,13z",
            ).toNodes(),
            fill = SolidColor(Color.Black),
        )
    }.build()

    /** lucide `paperclip`: attach a file or photo. */
    val Paperclip: ImageVector = ImageVector.Builder("Paperclip", 24.dp, 24.dp, 24f, 24f).apply {
        addPath(
            pathData = PathParser().parsePathString(
                "m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551",
            ).toNodes(),
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 2f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
    }.build()

    /** lucide `users`: the squad chip. */
    val Users: ImageVector = lucide("Users") {
        stroke { moveTo(16f, 21f); verticalLineTo(19f); arcTo(4f, 4f, 0f, false, false, 12f, 15f); horizontalLineTo(6f); arcTo(4f, 4f, 0f, false, false, 2f, 19f); verticalLineTo(21f) }
        stroke { moveTo(13f, 7f); arcTo(4f, 4f, 0f, true, true, 5f, 7f); arcTo(4f, 4f, 0f, true, true, 13f, 7f); close() }
        stroke { moveTo(22f, 21f); verticalLineTo(19f); arcTo(4f, 4f, 0f, false, false, 19f, 15.13f) }
        stroke { moveTo(16f, 3.13f); arcTo(4f, 4f, 0f, false, true, 16f, 10.88f) }
    }
}
