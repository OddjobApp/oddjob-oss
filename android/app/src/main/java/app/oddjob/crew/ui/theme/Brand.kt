package app.oddjob.crew.ui.theme

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.oddjob.crew.R

/** The bowler hat in the site's round badge: card fill, 20% foreground ring, soft indigo glow. */
@Composable
fun HatBadge(size: Dp, glow: Boolean = true) {
    Box(contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(size)
                // The glow is painted past the badge's bounds without taking layout
                // space. Not blur(): Compose clips a blurred layer to its bounds,
                // which drew it as a hard-edged square.
                .drawBehind {
                    if (glow) {
                        val radius = this.size.minDimension * 0.95f
                        drawCircle(
                            Brush.radialGradient(
                                listOf(Color(0xFF6366F1).copy(alpha = 0.35f), Color.Transparent),
                                center = center,
                                radius = radius,
                            ),
                            radius = radius,
                        )
                    }
                }
                .background(MaterialTheme.colorScheme.surfaceContainerHigh, CircleShape)
                .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = 0.2f), CircleShape)
                .padding(size / 14),
            contentAlignment = Alignment.Center,
        ) {
            Image(painterResource(R.drawable.oddjob_hat), contentDescription = "Oddjob")
        }
    }
}

/**
 * The login lockup from the site (Login.tsx, `login-brand-lockup`): hat badge,
 * "Oddjob" set heavy and tight, and the tagline in spaced capitals.
 */
@Composable
fun BrandLockup(modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            HatBadge(52.dp)
            Text(
                "Oddjob",
                style = MaterialTheme.typography.displaySmall.copy(
                    fontWeight = FontWeight.Bold,
                    letterSpacing = (-0.05).em,
                    fontSize = 40.sp,
                ),
            )
        }
        Text(
            "GOVERNED AGENTIC OPERATIONS",
            style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.16.em, fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
        )
    }
}

/**
 * The launch screen, shown while the app checks the saved session: the hat
 * where the system splash left it, and the "Oddjob AI" wordmark under it (the
 * same words as the splash's branding image).
 */
@Composable
fun LaunchLockup(modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
        HatBadge(112.dp)
        Text(
            "Oddjob AI",
            style = MaterialTheme.typography.displaySmall.copy(
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.05).em,
                fontSize = 36.sp,
            ),
        )
        Text(
            "GOVERNED AGENTIC OPERATIONS",
            style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.16.em, fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
        )
    }
}

/** A compact hat + wordmark for top bars. */
@Composable
fun BrandTitle(subtitle: String? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        HatBadge(34.dp, glow = false)
        Column {
            Text("Oddjob", style = MaterialTheme.typography.titleLarge.copy(letterSpacing = (-0.03).em))
            subtitle?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** The site's login backdrop: an indigo glow from the top left over near-black. */
val LoginBackdrop: Brush = Brush.radialGradient(
    colors = listOf(Color(0xFF6366F1).copy(alpha = 0.16f), Color.Transparent),
    center = androidx.compose.ui.geometry.Offset(0f, 0f),
    radius = 1400f,
)
