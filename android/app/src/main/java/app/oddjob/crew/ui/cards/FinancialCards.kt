package app.oddjob.crew.ui.cards

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.oddjob.crew.data.CrewMoney
import app.oddjob.crew.data.FinancialCalculation
import app.oddjob.crew.data.FinancialForecast
import app.oddjob.crew.data.FinancialReports
import app.oddjob.crew.data.FinancialSnapshot
import app.oddjob.crew.data.SnapshotComparison
import app.oddjob.crew.data.WorkspaceItem
import app.oddjob.crew.ui.theme.WorkspaceIcon
import kotlinx.coroutines.launch

/**
 * A QuickBooks result item: a snapshot or comparison, a forecast, a verified
 * calculation, a report, or a plain record, in that order of precedence (the
 * web WorkspaceResultCard's).
 */
@Composable
fun QuickBooksItemBody(item: WorkspaceItem, saveSnapshot: suspend (String, String, Int?) -> String?) {
    val snapshot = remember(item.snapshot) { FinancialSnapshot.parse(item.snapshot) }
    val comparison = remember(item.snapshotComparison) { SnapshotComparison.parse(item.snapshotComparison) }
    val forecast = remember(item.forecast) { FinancialForecast.parse(item.forecast) }
    val calculation = remember(item.calculation) { FinancialCalculation.parse(item.calculation) }
    when {
        snapshot != null || comparison != null -> SnapshotView(snapshot, comparison, saveSnapshot)
        forecast != null -> ForecastView(forecast)
        calculation != null -> CalculationView(calculation)
        item.quickBooksReport != null -> ReportView(item)
        else -> {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                WorkspaceIcon(item.kind, "quickbooks", size = 16.dp)
                Text(item.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            }
            listOfNotNull(item.quickBooksEntity, item.date).takeIf { it.isNotEmpty() }?.let { Small(it.joinToString(" · ")) }
            item.preview?.let { Small(it) }
        }
    }
}

@Composable
private fun Small(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** A two-or-more column table that scrolls sideways rather than squeezing figures. */
@Composable
private fun Table(header: List<String>, rows: List<List<String>>, emphasis: (Int) -> Boolean = { false }, firstWidth: Int = 150) {
    Column(Modifier.horizontalScroll(rememberScrollState()).heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
        @Composable
        fun line(cells: List<String>, bold: Boolean, muted: Boolean) {
            Row(Modifier.padding(vertical = 3.dp)) {
                cells.forEachIndexed { i, c ->
                    Text(
                        c,
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = if (bold) FontWeight.SemiBold else null,
                        color = if (muted) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                        textAlign = if (i == 0) TextAlign.Start else TextAlign.End,
                        modifier = Modifier.width(if (i == 0) firstWidth.dp else 110.dp),
                    )
                }
            }
        }
        line(header, bold = true, muted = true)
        HorizontalDivider()
        rows.forEachIndexed { i, r -> line(r, emphasis(i), muted = false) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ReportView(item: WorkspaceItem) {
    val report = remember(item.body, item.currency, item.moneyColumns) { FinancialReports.parse(item.body, item.currency, item.moneyColumns) }
    var showAll by rememberSaveable(item.id) { mutableStateOf(false) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        WorkspaceIcon("accounting", "quickbooks", size = 16.dp)
        Text(item.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        item.currency?.let { Small(it) }
    }
    (if (item.reportStart != null && item.reportEnd != null) "${item.reportStart} → ${item.reportEnd}" else item.preview)?.let { Small(it) }
    if (report.kpis.isNotEmpty()) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            report.kpis.forEach { k ->
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = if (k.highlight) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                ) {
                    Column(Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
                        Text(k.label, style = MaterialTheme.typography.labelSmall)
                        Text(k.value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
    if (report.rows.isNotEmpty()) {
        TextButton(onClick = { showAll = !showAll }) { Text(if (showAll) "Hide report" else "Show report (${report.rows.size} lines)") }
        if (showAll) {
            Table(report.columns, report.rows.map { r -> r.cells + List((report.columns.size - r.cells.size).coerceAtLeast(0)) { "" } }, emphasis = { i ->
                report.rows[i].let { it.summary || it.majorTotal || it.sectionHeader }
            }, firstWidth = 180)
        }
    }
}

@Composable
private fun CalculationView(c: FinancialCalculation) {
    var expanded by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(c.heading, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        Small("Verified tool result")
    }
    if (c.totals.isEmpty()) Text("No matching records.", style = MaterialTheme.typography.bodyMedium)
    c.totals.forEach { (currency, value, count) ->
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            Text(CrewMoney.format(value, currency), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Small("$currency · $count records")
        }
    }
    Small("QuickBooks · ${c.entity} · ${c.filter} · ${c.matchedRecords} records · All pages included")
    TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Hide calculation" else "Show calculation") }
    if (expanded) Small("SUM of ${c.field} over every matching ${c.entity} record, grouped by currency. Values are summed exactly as QuickBooks reports them.")
}

@Composable
private fun ForecastView(f: FinancialForecast) {
    var details by remember { mutableStateOf(false) }
    Text("Financial forecast · ${f.currency}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
    Small("${f.method.replace('_', ' ')} · ${f.periodUnit} periods${f.asOf?.let { " · As of $it" } ?: ""} · Projection")
    f.assessment?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    Table(
        header = listOf("Period", f.valueLabel) + f.scenarios.map { it.first },
        rows = f.periods.mapIndexed { i, p -> listOf(p, CrewMoney.format(f.values.getOrNull(i), f.currency)) + f.scenarios.map { CrewMoney.format(it.second.getOrNull(i), f.currency) } },
        firstWidth = 110,
    )
    if (f.assumptions.isNotEmpty()) {
        TextButton(onClick = { details = !details }) { Text(if (details) "Hide assumptions" else "Show calculation and assumptions") }
        if (details) f.assumptions.forEach { Small("• $it") }
    }
    if (f.warnings.isNotEmpty()) {
        Text("Excluded commitments (${f.warnings.size})", style = MaterialTheme.typography.labelLarge)
        f.warnings.forEach { Small("• $it") }
    }
}

@Composable
private fun SnapshotView(s: FinancialSnapshot?, c: SnapshotComparison?, saveSnapshot: suspend (String, String, Int?) -> String?) {
    val scope = rememberCoroutineScope()
    var saved by rememberSaveable(s?.id) { mutableStateOf(s?.saved == true) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    if (s != null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(s.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Small(if (saved) "Saved" else "Draft")
        }
        listOfNotNull(s.period, s.capturedAt?.let { "Captured $it" }).takeIf { it.isNotEmpty() }?.let { Small(it.joinToString(" · ")) }
        Table(listOf("Metric", "Value"), s.metrics.map { (label, value, currency) -> listOf(label, CrewMoney.format(value, currency)) }, firstWidth = 170)
        if (s.assumptions.isNotEmpty()) s.assumptions.forEach { Small("• $it") }
        if (s.exclusions.isNotEmpty()) Small("Excluded: ${s.exclusions.joinToString("; ")}")
        if (!saved) {
            Button(enabled = !busy, onClick = {
                busy = true
                error = null
                scope.launch {
                    val failure = saveSnapshot(s.sessionKey, s.id, s.organizationId)
                    if (failure == null) saved = true else error = failure
                    busy = false
                }
            }) { Text(if (busy) "Saving…" else "Save snapshot") }
        } else {
            Small("Frozen values can be retrieved by name or ID and compared later.")
        }
        error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
    }
    if (c != null) {
        Text("${c.baseline} → ${c.current}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Table(listOf("Metric", c.baseline, c.current, "Change", "%"), c.rows, firstWidth = 150)
        c.warnings.forEach { Small("• $it") }
    }
}
