const fs = require('fs');
const path = require('path');

const targetFile = path.resolve('client/src/modules/operations/components/CycleGanttChart.tsx');
let content = fs.readFileSync(targetFile, 'utf8');

const replacements = [
    {
        target: `export interface CycleGanttChartProps {
    blueprints: Blueprint[];
    startDate?: Date;
    runs?: ActualRun[];
    mini?: boolean;
    className?: string;
    /** Called when user finishes dragging — provides the updated blueprint array */
    onChange?: (blueprints: Blueprint[]) => void;
    /** Active time unit */
    timeUnit?: TimeUnit;
}`,
        replacement: `export interface CycleGanttChartProps {
    blueprints: Blueprint[];
    startDate?: Date;
    runs?: ActualRun[];
    mini?: boolean;
    className?: string;
    /** Called when user finishes dragging — provides the updated blueprint array */
    onChange?: (blueprints: Blueprint[]) => void;
    /** Active time unit */
    timeUnit?: TimeUnit;
    excludeWeekends?: boolean;
}`
    },
    {
        target: `export function CycleGanttChart({
    blueprints, startDate, runs = [], mini = false, className, onChange, timeUnit,
}: CycleGanttChartProps) {`,
        replacement: `export function CycleGanttChart({
    blueprints, startDate, runs = [], mini = false, className, onChange, timeUnit, excludeWeekends,
}: CycleGanttChartProps) {`
    },
    {
        target: `function buildAxisTicks(domainStart: number, domainEnd: number, unitW: number, start: Date, unit: TimeUnit) {
    const total = Math.max(1, domainEnd - domainStart);
    const targetCount = Math.max(4, Math.min(16, Math.floor(560 / Math.max(unitW, 1))));
    const interval = Math.max(1, Math.round(total / targetCount));
    const first = Math.floor(domainStart / interval) * interval;
    const ticks: { day: number; label: string; isMonth: boolean }[] = [];
    for (let u = first; u <= domainEnd + interval; u += interval) {
        if (u < domainStart - interval) continue;
        const date = addUnits(start, u, unit);`,
        replacement: `function buildAxisTicks(domainStart: number, domainEnd: number, unitW: number, start: Date, unit: TimeUnit, excludeWeekends?: boolean) {
    const total = Math.max(1, domainEnd - domainStart);
    const targetCount = Math.max(4, Math.min(16, Math.floor(560 / Math.max(unitW, 1))));
    const interval = Math.max(1, Math.round(total / targetCount));
    const first = Math.floor(domainStart / interval) * interval;
    const ticks: { day: number; label: string; isMonth: boolean }[] = [];
    for (let u = first; u <= domainEnd + interval; u += interval) {
        if (u < domainStart - interval) continue;
        const date = addUnits(start, u, unit, excludeWeekends);`
    },
    {
        target: `function buildTaskHistoryEvents(task: GanttTask, actual: ActualRun | undefined, cycleStart: Date, unit: TimeUnit, nowOffset: number): TimelineHistoryEvent[] {
    const events: TimelineHistoryEvent[] = [
        {
            id: \`\${task.name}-scheduled\`,
            type: "ActivityTaskScheduled",
            label: "Scheduled",
            detail: \`Planned at +\${formatUnitLabel(task.earlyStart, unit)}\`,
            offset: task.earlyStart,
            tone: "scheduled",
        },
    ];

    if (actual?.startedAt) {
        const startedOffset = unitsBetween(cycleStart, new Date(actual.startedAt), unit);`,
        replacement: `function buildTaskHistoryEvents(task: GanttTask, actual: ActualRun | undefined, cycleStart: Date, unit: TimeUnit, nowOffset: number, excludeWeekends?: boolean): TimelineHistoryEvent[] {
    const events: TimelineHistoryEvent[] = [
        {
            id: \`\${task.name}-scheduled\`,
            type: "ActivityTaskScheduled",
            label: "Scheduled",
            detail: \`Planned at +\${formatUnitLabel(task.earlyStart, unit)}\`,
            offset: task.earlyStart,
            tone: "scheduled",
        },
    ];

    if (actual?.startedAt) {
        const startedOffset = unitsBetween(cycleStart, new Date(actual.startedAt), unit, excludeWeekends);`
    },
    {
        target: `    if (actual?.finishedAt) {
        const finishedOffset = unitsBetween(cycleStart, new Date(actual.finishedAt), unit);`,
        replacement: `    if (actual?.finishedAt) {
        const finishedOffset = unitsBetween(cycleStart, new Date(actual.finishedAt), unit, excludeWeekends);`
    },
    {
        target: `    // Manage dynamic playhead offset (re-rendered on sub-day updates)
    const [currentOffset, setCurrentOffset] = useState(() => {
        return unitsBetween(cycleStart, new Date(), activeUnit);
    });

    useEffect(() => {
        setCurrentOffset(unitsBetween(cycleStart, new Date(), activeUnit));

        const isSubDay = ["ms", "s", "m", "h"].includes(activeUnit);
        if (!isSubDay) return;

        const intervalMs = activeUnit === "ms" ? 50 : activeUnit === "s" ? 1000 : activeUnit === "m" ? 5000 : 30000;
        const timer = setInterval(() => {
            setCurrentOffset(unitsBetween(cycleStart, new Date(), activeUnit));
        }, intervalMs);`,
        replacement: `    // Manage dynamic playhead offset (re-rendered on sub-day updates)
    const [currentOffset, setCurrentOffset] = useState(() => {
        return unitsBetween(cycleStart, new Date(), activeUnit, excludeWeekends);
    });

    useEffect(() => {
        setCurrentOffset(unitsBetween(cycleStart, new Date(), activeUnit, excludeWeekends));

        const isSubDay = ["ms", "s", "m", "h"].includes(activeUnit);
        if (!isSubDay) return;

        const intervalMs = activeUnit === "ms" ? 50 : activeUnit === "s" ? 1000 : activeUnit === "m" ? 5000 : 30000;
        const timer = setInterval(() => {
            setCurrentOffset(unitsBetween(cycleStart, new Date(), activeUnit, excludeWeekends));
        }, intervalMs);`
    },
    {
        target: `    const actualEnd = useMemo(() => {
        let max = 0;
        runs.forEach(r => {
            if (!r.startedAt) return;
            const start = unitsBetween(cycleStart, new Date(r.startedAt), activeUnit);
            const finish = r.finishedAt ? unitsBetween(cycleStart, new Date(r.finishedAt), activeUnit) : currentOffset;
            max = Math.max(max, start, finish);
        });
        return max;
    }, [runs, cycleStart, activeUnit, currentOffset]);`,
        replacement: `    const actualEnd = useMemo(() => {
        let max = 0;
        runs.forEach(r => {
            if (!r.startedAt) return;
            const start = unitsBetween(cycleStart, new Date(r.startedAt), activeUnit, excludeWeekends);
            const finish = r.finishedAt ? unitsBetween(cycleStart, new Date(r.finishedAt), activeUnit, excludeWeekends) : currentOffset;
            max = Math.max(max, start, finish);
        });
        return max;
    }, [runs, cycleStart, activeUnit, currentOffset, excludeWeekends]);`
    },
    {
        target: `    const axisTicks = useMemo(() => buildAxisTicks(domain.start, domain.end, dayW, cycleStart, activeUnit), [domain.start, domain.end, dayW, cycleStart, activeUnit]);`,
        replacement: `    const axisTicks = useMemo(() => buildAxisTicks(domain.start, domain.end, dayW, cycleStart, activeUnit, excludeWeekends), [domain.start, domain.end, dayW, cycleStart, activeUnit, excludeWeekends]);`
    },
    {
        target: `    const inspectedEvents = useMemo(
        () => inspectedTask ? buildTaskHistoryEvents(inspectedTask, actualByName.get(inspectedTask.name), cycleStart, activeUnit, currentOffset) : [],
        [inspectedTask, actualByName, cycleStart, activeUnit, currentOffset],
    );`,
        replacement: `    const inspectedEvents = useMemo(
        () => inspectedTask ? buildTaskHistoryEvents(inspectedTask, actualByName.get(inspectedTask.name), cycleStart, activeUnit, currentOffset, excludeWeekends) : [],
        [inspectedTask, actualByName, cycleStart, activeUnit, currentOffset, excludeWeekends],
    );`
    },
    {
        target: `                const label = d.type === "move"
                    ? \`Start: offset \${computedStartVal.toFixed(0)} (\${formatAxisLabel(computedStartVal, addUnits(cycleStart, computedStartVal, activeUnit), activeUnit)})\`
                    : \`Duration: \${Math.max(0, d.originalValue + deltaUnits)}\${activeUnit}\`;`,
        replacement: `                const label = d.type === "move"
                    ? \`Start: offset \${computedStartVal.toFixed(0)} (\${formatAxisLabel(computedStartVal, addUnits(cycleStart, computedStartVal, activeUnit, excludeWeekends), activeUnit)})\`
                    : \`Duration: \${Math.max(0, d.originalValue + deltaUnits)}\${activeUnit}\`;`
    },
    {
        target: `                        let actualX: number | null = null, actualW = 0;
                        if (actual?.startedAt) {
                            const aS = unitsBetween(cycleStart, new Date(actual.startedAt), activeUnit);
                            const aE = actual.finishedAt ? unitsBetween(cycleStart, new Date(actual.finishedAt), activeUnit) : currentOffset;`,
        replacement: `                        let actualX: number | null = null, actualW = 0;
                        if (actual?.startedAt) {
                            const aS = unitsBetween(cycleStart, new Date(actual.startedAt), activeUnit, excludeWeekends);
                            const aE = actual.finishedAt ? unitsBetween(cycleStart, new Date(actual.finishedAt), activeUnit, excludeWeekends) : currentOffset;`
    }
];

// Normalize newlines helper
const normalize = (str) => str.replace(/\r\n/g, '\n');

let normalizedContent = normalize(content);

for (const [idx, item] of replacements.entries()) {
    const target = normalize(item.target);
    const replacement = normalize(item.replacement);
    
    if (normalizedContent.includes(target)) {
        normalizedContent = normalizedContent.replace(target, replacement);
        console.log(`Applied replacement #${idx + 1}`);
    } else {
        console.error(`ERROR: Replacement #${idx + 1} target not found!`);
        process.exit(1);
    }
}

fs.writeFileSync(targetFile, normalizedContent, 'utf8');
console.log('Successfully patched CycleGanttChart.tsx');
