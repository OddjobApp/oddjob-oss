package app.oddjob.crew.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.oddjob.crew.R

/**
 * The website's dark theme, so the app reads as the same product. Tokens are
 * the `.dark` block of client/src/index.css (shadcn slate), converted from HSL:
 *
 *   --background / --card    222.2 84% 4.9%    #020817
 *   --foreground / --primary 210 40% 98%       #F8FAFC
 *   --primary-foreground     222.2 47.4% 11.2% #0F172A
 *   --secondary/--muted/--border/--input 217.2 32.6% 17.5% #1E293B
 *   --muted-foreground       215 20.2% 85%     #D1D7E0
 *   --destructive            0 62.8% 30.6%     #7F1D1D
 *   --ring                   212.7 26.8% 83.9% #CBD5E1
 *   --radius                 0.5rem
 *
 * Dark only, as asked: the app always looks like the site's dark mobile view.
 */
object OddjobColors {
    val Background = Color(0xFF020817)
    val Foreground = Color(0xFFF8FAFC)
    val PrimaryForeground = Color(0xFF0F172A)
    val Slate800 = Color(0xFF1E293B)
    val Slate700 = Color(0xFF334155)
    val MutedForeground = Color(0xFFD1D7E0)
    val Subtle = Color(0xFF94A3B8)
    val Destructive = Color(0xFF7F1D1D)
    val Ring = Color(0xFFCBD5E1)

    /** The violet of the site's "Active Squad" chip. */
    val Violet = Color(0xFF8B5CF6)
    /** The emerald of "Close Room" and the online dot. */
    val Emerald = Color(0xFF10B981)
}

private val scheme = darkColorScheme(
    primary = OddjobColors.Foreground,
    onPrimary = OddjobColors.PrimaryForeground,
    // The site draws a user's own turn in bg-primary: near-white with dark text.
    primaryContainer = OddjobColors.Foreground,
    onPrimaryContainer = OddjobColors.PrimaryForeground,
    secondary = OddjobColors.Slate800,
    onSecondary = OddjobColors.Foreground,
    secondaryContainer = OddjobColors.Slate800,
    onSecondaryContainer = OddjobColors.Foreground,
    tertiary = OddjobColors.Violet,
    onTertiary = OddjobColors.Foreground,
    tertiaryContainer = Color(0xFF1E1538),
    onTertiaryContainer = Color(0xFFE9E3FF),
    background = OddjobColors.Background,
    onBackground = OddjobColors.Foreground,
    surface = OddjobColors.Background,
    onSurface = OddjobColors.Foreground,
    surfaceVariant = OddjobColors.Slate800,
    onSurfaceVariant = OddjobColors.MutedForeground,
    surfaceTint = Color.Transparent,
    surfaceContainerLowest = OddjobColors.Background,
    surfaceContainerLow = Color(0xFF050C1C),
    surfaceContainer = Color(0xFF0A1122),
    surfaceContainerHigh = Color(0xFF0F172A),
    surfaceContainerHighest = OddjobColors.Slate800,
    inverseSurface = OddjobColors.Foreground,
    inverseOnSurface = OddjobColors.PrimaryForeground,
    outline = OddjobColors.Slate700,
    outlineVariant = OddjobColors.Slate800,
    error = Color(0xFFF87171),
    onError = OddjobColors.PrimaryForeground,
    errorContainer = OddjobColors.Destructive,
    onErrorContainer = Color(0xFFFEE2E2),
    scrim = Color(0xCC000000),
)

@OptIn(ExperimentalTextApi::class)
private fun variable(res: Int, weight: Int) =
    Font(res, FontWeight(weight), variationSettings = FontVariation.Settings(FontVariation.weight(weight)))

/** --font-sans: Inter. */
val Inter = FontFamily(
    variable(R.font.inter, 400),
    variable(R.font.inter, 500),
    variable(R.font.inter, 600),
    variable(R.font.inter, 700),
)

/** --font-heading: Space Grotesk. */
val SpaceGrotesk = FontFamily(
    variable(R.font.space_grotesk, 500),
    variable(R.font.space_grotesk, 600),
    variable(R.font.space_grotesk, 700),
)

private val typography = Typography().let { t ->
    t.copy(
        displayLarge = t.displayLarge.copy(fontFamily = SpaceGrotesk),
        displayMedium = t.displayMedium.copy(fontFamily = SpaceGrotesk),
        displaySmall = t.displaySmall.copy(fontFamily = SpaceGrotesk),
        headlineLarge = t.headlineLarge.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.Bold),
        headlineMedium = t.headlineMedium.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.Bold),
        headlineSmall = t.headlineSmall.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.SemiBold),
        titleLarge = t.titleLarge.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.Bold),
        titleMedium = t.titleMedium.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.SemiBold),
        titleSmall = t.titleSmall.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.SemiBold),
        bodyLarge = t.bodyLarge.copy(fontFamily = Inter),
        bodyMedium = t.bodyMedium.copy(fontFamily = Inter),
        bodySmall = t.bodySmall.copy(fontFamily = Inter),
        labelLarge = t.labelLarge.copy(fontFamily = Inter, fontWeight = FontWeight.SemiBold),
        labelMedium = t.labelMedium.copy(fontFamily = Inter, fontWeight = FontWeight.Medium),
        labelSmall = t.labelSmall.copy(fontFamily = Inter, fontWeight = FontWeight.Medium),
    )
}

/** --radius 0.5rem for small controls; the site's cards and pills round further. */
private val shapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun CrewTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = typography, shapes = shapes, content = content)
}
