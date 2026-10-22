import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { PageShell } from "@domain-ui/core/ui/components/layout/PageShell";
import { useState, useMemo } from 'react';
import { ErrorBoundary } from '@domain-ui/core/ui/components/shared/ErrorBoundary';
import { CRON_TEMPLATES } from '../job-constants.js';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Clock, MoreVertical, Building2, Search } from 'lucide-react';
import { useOrgContext } from '@domain-ui/core/ui/hooks/use-org-context';
import { useAuth } from '@domain-ui/auth/ui/modules/auth/hooks/use-auth';
import CronExpressionBuilder from '@domain-ui/core/ui/components/shared/CronExpressionBuilder';
import { useDebounce } from '@domain-ui/core/ui/hooks/useDebounce';
import { RefreshButton } from '@domain-ui/core/ui/components/ui/refresh-button';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@domain-ui/core/ui/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@domain-ui/core/ui/components/ui/dialog';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@domain-ui/core/ui/components/ui/dropdown-menu';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { TIMEZONES } from '@/lib/timezones';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface Schedule {
    id: number;
    name: string;
    description?: string;
    pattern: number;
    patternLabel?: string;
    patternString?: any;
    timezone?: string;
    isActive: boolean;
    createdAt?: string;
    organizationId?: number | null;
}

const WEEKDAYS = [
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
    { value: 7, label: 'Sun' },
];

const PATTERN_TYPES = [
    { value: 1, label: 'Daily' },
    { value: 2, label: 'Weekly' },
    { value: 3, label: 'Monthly' },
    { value: 4, label: 'Custom Cron' },
];

export default function SchedulesPage() {
    const { toast } = useToast();
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearchQuery = useDebounce(searchQuery, 300);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
    const queryClient = useQueryClient();

    // Form state
    const [scheduleName, setScheduleName] = useState('');
    const [scheduleDescription, setScheduleDescription] = useState('');
    const [pattern, setPattern] = useState(1);
    const [starttime, setStarttime] = useState('09:00');
    const [timezone, setTimezone] = useState('UTC');
    const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [dayofmonth, setDayofmonth] = useState(1);
    const [cronExpression, setCronExpression] = useState('0 * * * *');
    const [isActive, setIsActive] = useState(true);
    const [validationError, setValidationError] = useState('');

    // Org / auth context
    const { selectedOrgId } = useOrgContext();
    const { adminRole } = useAuth();
    const isSuperAdmin = adminRole?.isSuperAdmin === true;
    const showOrgColumn = isSuperAdmin && selectedOrgId === null;

    // Fetch organizations for super-admin column
    const { data: organizationsData } = useQuery<{ organizations: Array<{ id: number; name: string }> }>({
        queryKey: ['/api/admin/organizations'],
        queryFn: async () => {
            const res = await fetch('/api/admin/organizations', { credentials: 'include' });
            if (!res.ok) return { organizations: [] };
            return res.json();
        },
        enabled: showOrgColumn,
        staleTime: 5 * 60 * 1000,
    });
    const orgMap = useMemo(() => {
        const map: Record<number, string> = {};
        (organizationsData?.organizations || []).forEach(org => { map[org.id] = org.name; });
        return map;
    }, [organizationsData]);

    // Fetch schedules
    const { data: schedules = [], isLoading } = useQuery<Schedule[]>({
        queryKey: ['/api/schedules', selectedOrgId],
    });

    const filteredSchedules = schedules.filter(s =>
        s.name.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
        (s.patternLabel && s.patternLabel.toLowerCase().includes(debouncedSearchQuery.toLowerCase()))
    );

    const openCreateDialog = () => {
        setEditingSchedule(null);
        setScheduleName('');
        setScheduleDescription('');
        setPattern(1);
        setStarttime('09:00');
        setTimezone('UTC');
        setWeekdays([1, 2, 3, 4, 5]);
        setDayofmonth(1);
        setCronExpression('0 * * * *');
        setIsActive(true);
        setValidationError('');
        setIsDialogOpen(true);
    };

    const openEditDialog = (schedule: Schedule) => {
        setEditingSchedule(schedule);
        setScheduleName(schedule.name);
        setScheduleDescription(schedule.description || '');
        setPattern(schedule.pattern);
        setStarttime(schedule.patternString?.starttime || '09:00');
        setTimezone(schedule.timezone || 'UTC');
        const wds = schedule.patternString?.weekdays;
        setWeekdays(wds ? String(wds).split(',').map(Number) : [1, 2, 3, 4, 5]);
        setDayofmonth(schedule.patternString?.dayofmonth || 1);
        setCronExpression(schedule.patternString?.cron || '0 * * * *');
        setIsActive(schedule.isActive);
        setValidationError('');
        setIsDialogOpen(true);
    };

    const toggleWeekday = (day: number) => {
        setWeekdays(prev =>
            prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b)
        );
    };

    // Save mutation (create or update)
    const saveMutation = useMutation({
        mutationFn: async () => {
            let patternJson: any = {};
            if (pattern === 1)      patternJson = { starttime };
            else if (pattern === 2) patternJson = { starttime, weekdays: weekdays.join(',') };
            else if (pattern === 3) patternJson = { starttime, dayofmonth };
            else if (pattern === 4) patternJson = { cron: cronExpression };

            const body = {
                name: scheduleName,
                description: scheduleDescription || undefined,
                pattern,
                patternString: patternJson,
                patternLabel: pattern === 4
                    ? cronExpression
                    : pattern === 1 ? `Daily at ${starttime}`
                    : pattern === 2 ? `Weekly ${weekdays.map(d => WEEKDAYS.find(w => w.value === d)?.label).join(',')}`
                    : `Monthly day ${dayofmonth}`,
                timezone: pattern !== 4 ? timezone : undefined,
                isActive,
            };

            const url = editingSchedule ? `/api/schedules/${editingSchedule.id}` : '/api/schedules';
            const method = editingSchedule ? 'PUT' : 'POST';
            const res = await apiRequest(method, url, body);
            if (!res.ok) {
                const err = await res.text();
                throw new Error(err || 'Failed to save schedule');
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/schedules'] });
            toast({ title: 'Success', description: `Automation ${editingSchedule ? 'updated' : 'created'} successfully` });
            setIsDialogOpen(false);
            setEditingSchedule(null);
        },
        onError: (err: Error) => {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await apiRequest('DELETE', `/api/schedules/${id}`);
            if (!res.ok) throw new Error('Failed to delete schedule');
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/schedules'] });
            toast({ title: 'Deleted', description: 'Automation removed successfully' });
        },
        onError: (err: Error) => {
            toast({ title: 'Error', description: err.message, variant: 'destructive' });
        },
    });

    const handleSave = () => {
        setValidationError('');
        if (!scheduleName.trim()) {
            setValidationError('Automation name is required');
            return;
        }
        if (pattern === 2 && weekdays.length === 0) {
            setValidationError('Select at least one weekday for a weekly schedule');
            return;
        }
        if (pattern === 3 && (dayofmonth < 1 || dayofmonth > 31)) {
            setValidationError('Day of month must be between 1 and 31');
            return;
        }
        saveMutation.mutate();
    };

    const handleDelete = (id: number) => {
        if (confirm('Delete this automation timing rule? This cannot be undone.')) deleteMutation.mutate(id);
    };

    return (
        <ErrorBoundary name="Automations">
        <PageShell
            title="Automations"
            description="Manage reusable timing rules for your workflows. Connect a rule to scheduled work to run it."
            contentClassName="space-y-6 p-4 md:p-6"
            headerAction={<Button onClick={openCreateDialog} data-testid="button-create-schedule"><Plus className="mr-2 h-4 w-4" />New automation</Button>}
        >
            {/* Table card */}
            <Card className="overflow-hidden border-border bg-card">
                <CardHeader className="border-b border-border p-4 sm:p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                            <CardTitle className="text-xl font-semibold text-foreground flex items-center gap-3">

                                Timing rules
                            </CardTitle>
                            <CardDescription className="text-sm text-muted-foreground mt-2">
                                Review recurrence, time zone, and whether each rule is enabled.
                            </CardDescription>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                            <div className="relative group w-full sm:w-auto">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search automations…"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="pl-9 h-10 w-full bg-muted/30 border-border rounded-xl text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:ring-primary/40 focus:border-primary/20 transition-all sm:w-64"
                                    data-testid="input-search-schedules"
                                />
                            </div>
                            <RefreshButton
                                onRefresh={() => queryClient.invalidateQueries({ queryKey: ['/api/schedules'] })}
                                isLoading={isLoading}
                                tooltipText="Refresh automations"
                                className="h-10 w-10 border-border bg-foreground/5 text-foreground hover:bg-foreground/10"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-4 sm:p-6">
                    {isLoading ? (
                        <div className="text-center py-8 text-muted-foreground">Loading automations…</div>
                    ) : filteredSchedules.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">No automations found.</p>
                        </div>
                    ) : (
                        <>
                        <div className="grid gap-3 md:hidden">
                            {filteredSchedules.map(schedule => (
                                <div key={schedule.id} data-testid={`card-schedule-${schedule.id}`} className="rounded-2xl border border-border bg-muted/30 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 space-y-1">
                                            <h3 className="truncate text-sm font-semibold tracking-tight text-foreground">{schedule.name}</h3>
                                            {schedule.description && (
                                                <p className="line-clamp-2 text-xs font-bold text-muted-foreground">{schedule.description}</p>
                                            )}
                                        </div>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" aria-label={`Actions for ${schedule.name}`} data-testid={`button-actions-mobile-${schedule.id}`}>
                                                    <MoreVertical className="w-4 h-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => openEditDialog(schedule)} data-testid={`button-edit-mobile-${schedule.id}`}>
                                                    <Pencil className="w-4 h-4 mr-2" />
                                                    Edit
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() => handleDelete(schedule.id)}
                                                    className="text-destructive"
                                                    data-testid={`button-delete-mobile-${schedule.id}`}
                                                >
                                                    <Trash2 className="w-4 h-4 mr-2" />
                                                    Delete
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                    <div className="mt-4 grid gap-3 text-xs">
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="font-semibold text-muted-foreground">Recurrence</span>
                                            <span className="min-w-0 truncate text-right font-semibold text-muted-foreground">
                                                {schedule.patternLabel || PATTERN_TYPES.find(p => p.value === schedule.pattern)?.label || '-'}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="font-semibold text-muted-foreground">Timezone</span>
                                            <Badge variant="outline" className="bg-muted/30 border-border text-muted-foreground text-sm font-semibold">
                                                {schedule.timezone || 'UTC'}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="font-semibold text-muted-foreground">Status</span>
                                            {schedule.isActive
                                                ? <Badge>Enabled</Badge>
                                                : <Badge variant="secondary" className="bg-foreground/5 text-muted-foreground border-border text-sm font-semibold">Disabled</Badge>}
                                        </div>
                                        {showOrgColumn && (
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="font-semibold text-muted-foreground">Org</span>
                                                <span className="truncate text-right text-muted-foreground">
                                                    {schedule.organizationId ? orgMap[schedule.organizationId] || `Org #${schedule.organizationId}` : 'Global'}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="hidden overflow-x-auto md:block">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-border hover:bg-transparent bg-muted/30">
                                    <TableHead className="text-sm font-semibold text-muted-foreground py-4 pl-4">Automation</TableHead>
                                    <TableHead className="text-sm font-semibold text-muted-foreground py-4">Recurrence</TableHead>
                                    <TableHead className="text-sm font-semibold text-muted-foreground py-4">Time zone</TableHead>
                                    <TableHead className="text-sm font-semibold text-muted-foreground py-4">Status</TableHead>
                                    {showOrgColumn && <TableHead className="text-sm font-semibold text-muted-foreground py-4">Organization</TableHead>}
                                    <TableHead className="text-right text-sm font-semibold text-muted-foreground py-4 pr-4">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredSchedules.map(schedule => (
                                    <TableRow key={schedule.id} data-testid={`row-schedule-${schedule.id}`} className="border-border hover:bg-muted/30 transition-colors group/row">
                                        <TableCell className="py-4 pl-4 border-border">
                                            <div className="flex flex-col gap-1">
                                                <span className="text-[15px] font-semibold text-foreground tracking-tight group-hover/row:text-primary transition-colors">{schedule.name}</span>
                                                {schedule.description && (
                                                    <span className="text-sm font-semibold text-muted-foreground max-w-sm truncate">{schedule.description}</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="py-4 border-border">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded-xl bg-primary/5 border border-primary/10 group-hover/row:border-primary/30 transition-all">
                                                    <Clock className="w-4 h-4 text-primary" />
                                                </div>
                                                <span className="text-sm font-semibold text-muted-foreground tracking-tight">
                                                    {schedule.patternLabel || PATTERN_TYPES.find(p => p.value === schedule.pattern)?.label || '—'}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="py-4 border-border">
                                            <Badge variant="outline" className="bg-muted/30 border-border text-muted-foreground text-sm font-semibold px-3 h-7">
                                                {schedule.timezone || 'UTC'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="py-4 border-border">
                                            {schedule.isActive
                                                ? <Badge>Enabled</Badge>
                                                : <Badge variant="secondary" className="bg-foreground/5 text-muted-foreground border-border text-sm font-semibold px-4 h-8">Disabled</Badge>}
                                        </TableCell>
                                        {showOrgColumn && (
                                            <TableCell>
                                                {schedule.organizationId ? (
                                                    <Badge variant="outline" className="text-xs font-normal">
                                                        <Building2 className="w-3 h-3 mr-1" />
                                                        {orgMap[schedule.organizationId] || `Org #${schedule.organizationId}`}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">Global</span>
                                                )}
                                            </TableCell>
                                        )}
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" aria-label={`Actions for ${schedule.name}`} data-testid={`button-actions-${schedule.id}`}>
                                                        <MoreVertical className="w-4 h-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => openEditDialog(schedule)} data-testid={`button-edit-${schedule.id}`}>
                                                        <Pencil className="w-4 h-4 mr-2" />
                                                        Edit
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => handleDelete(schedule.id)}
                                                        className="text-destructive"
                                                        data-testid={`button-delete-${schedule.id}`}
                                                    >
                                                        <Trash2 className="w-4 h-4 mr-2" />
                                                        Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Create / Edit Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-3xl max-h-[90vh] border-border bg-background p-0 overflow-hidden">

                    <DialogHeader className="p-8 pb-0">
                        <div className="flex items-center gap-4 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                                <Clock className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                                <DialogTitle className="text-2xl font-semibold text-foreground">
                                    {editingSchedule ? 'Edit automation' : 'New automation'}
                                </DialogTitle>
                                <DialogDescription className="text-sm font-bold text-muted-foreground">
                                    {editingSchedule ? 'Update the timing rule for this automation.' : 'Choose a name, recurrence, and time zone for the timing rule.'}
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <ScrollArea className="h-[500px] px-8">
                        <div className="space-y-8 py-4">

                            {/* ── Details ── */}
                            <div className="space-y-6">
                                <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-3">
                                    <span className="h-px flex-1 bg-foreground/5" />
                                    Details
                                    <span className="h-px flex-1 bg-foreground/5" />
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2 space-y-2">
                                        <Label htmlFor="schedule-name" className="text-sm font-semibold text-muted-foreground ml-1">Automation name *</Label>
                                        <Input
                                            id="schedule-name"
                                            placeholder="e.g. Weekly operations review"
                                            value={scheduleName}
                                            onChange={e => setScheduleName(e.target.value)}
                                            className="h-12 bg-muted/30 border-border rounded-xl px-4 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:ring-primary/40 focus:border-primary/20 transition-all"
                                            data-testid="input-schedule-name"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="pattern-type" className="text-sm font-semibold text-muted-foreground ml-1">Recurrence *</Label>
                                        <Select value={String(pattern)} onValueChange={v => setPattern(Number(v))}>
                                            <SelectTrigger id="pattern-type" className="h-12 bg-muted/30 border-border rounded-xl px-4 text-sm font-semibold text-foreground focus:ring-primary/40 transition-all" data-testid="select-pattern-type">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-background border-border">
                                                {PATTERN_TYPES.map(pt => (
                                                    <SelectItem key={pt.value} value={String(pt.value)} className="text-sm font-bold text-foreground focus:bg-primary/20 transition-colors">{pt.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="flex items-end">
                                        <div className="flex items-center space-x-2">
                                            <Switch
                                                id="schedule-active"
                                                checked={isActive}
                                                onCheckedChange={setIsActive}
                                                data-testid="switch-schedule-active"
                                            />
                                            <Label htmlFor="schedule-active" className="cursor-pointer">Enabled</Label>
                                        </div>
                                    </div>

                                    <div className="col-span-2 space-y-2">
                                        <Label htmlFor="schedule-description">Description</Label>
                                        <Textarea
                                            id="schedule-description"
                                            placeholder="Describe what this timing rule is used for"
                                            value={scheduleDescription}
                                            onChange={e => setScheduleDescription(e.target.value)}
                                            rows={2}
                                            data-testid="input-schedule-description"
                                        />
                                    </div>
                                </div>
                            </div>

                            <Separator />

                            {/* ── Timing Configuration ── */}
                            <div className="space-y-6">
                                <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-3">
                                    <span className="h-px flex-1 bg-foreground/5" />
                                    Timing
                                    <span className="h-px flex-1 bg-foreground/5" />
                                </h3>

                                {/* Daily / Weekly / Monthly — time + timezone */}
                                {(pattern === 1 || pattern === 2 || pattern === 3) && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="start-time" className="text-sm font-semibold text-muted-foreground ml-1">Run Time (HH:MM) *</Label>
                                            <Input
                                                id="start-time"
                                                type="time"
                                                value={starttime}
                                                onChange={e => setStarttime(e.target.value)}
                                                className="h-12 bg-muted/30 border-border rounded-xl px-4 text-sm font-semibold text-foreground focus:ring-primary/40 focus:border-primary/20 transition-all invert-colors-dark"
                                                data-testid="input-start-time"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="timezone" className="text-sm font-semibold text-muted-foreground ml-1">Time zone *</Label>
                                            <Select value={timezone} onValueChange={setTimezone}>
                                                <SelectTrigger id="timezone" className="h-12 bg-muted/30 border-border rounded-xl px-4 text-sm font-semibold text-foreground focus:ring-primary/40 transition-all" data-testid="select-timezone">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="max-h-[300px] bg-background border-border">
                                                    {TIMEZONES.map(tz => (
                                                        <SelectItem key={tz.value} value={tz.value} className="text-sm font-bold text-foreground focus:bg-primary/20 transition-colors">{tz.label}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                )}

                                {/* Weekly — weekday picker */}
                                {pattern === 2 && (
                                    <div className="space-y-3">
                                        <Label>Days of the Week *</Label>
                                        <div className="flex flex-wrap gap-2">
                                            {WEEKDAYS.map(day => (
                                                <Button
                                                    key={day.value}
                                                    type="button"
                                                    variant={weekdays.includes(day.value) ? 'default' : 'outline'}
                                                    size="sm"
                                                    onClick={() => toggleWeekday(day.value)}
                                                    data-testid={`button-weekday-${day.value}`}
                                                >
                                                    {day.label}
                                                </Button>
                                            ))}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Selected: {weekdays.length > 0
                                                ? weekdays.map(d => WEEKDAYS.find(w => w.value === d)?.label).join(', ')
                                                : 'None'}
                                        </p>
                                    </div>
                                )}

                                {/* Monthly — day of month */}
                                {pattern === 3 && (
                                    <div className="space-y-2">
                                        <Label htmlFor="day-of-month">Day of Month (1–31) *</Label>
                                        <Input
                                            id="day-of-month"
                                            type="number"
                                            min={1}
                                            max={31}
                                            value={dayofmonth}
                                            onChange={e => setDayofmonth(Number(e.target.value))}
                                            data-testid="input-day-of-month"
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Runs on day {dayofmonth} of each month
                                        </p>
                                    </div>
                                )}

                                {/* Custom Cron — full advanced builder */}
                                {pattern === 4 && (
                                    <div className="space-y-3">
                                        {/* Quick templates */}
                                        <div className="space-y-1.5">
                                            <Label>Quick Templates</Label>
                                            <Select
                                                value=""
                                                onValueChange={v => { if (v) setCronExpression(v); }}
                                            >
                                                <SelectTrigger data-testid="select-cron-template">
                                                    <SelectValue placeholder="Pick a template…" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {CRON_TEMPLATES.map(t => (
                                                        <SelectItem key={t.value} value={t.value}>
                                                            {t.label} — <span className="font-mono text-xs">{t.value}</span>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {/* Advanced visual builder */}
                                        <CronExpressionBuilder
                                            value={cronExpression}
                                            onChange={setCronExpression}
                                            onValidationError={setValidationError}
                                            testIdPrefix="schedule"
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Validation error */}
                            {validationError && (
                                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                                    <p className="text-sm text-destructive">{validationError}</p>
                                </div>
                            )}
                        </div>
                    </ScrollArea>

                    <DialogFooter className="p-8 pt-4 bg-muted/30 border-t border-border">
                        <Button
                            variant="outline"
                            onClick={() => setIsDialogOpen(false)}
                            className="h-12 bg-transparent border-border text-muted-foreground text-sm font-semibold hover:bg-foreground/5 hover:text-foreground rounded-xl px-6 transition-all"
                            data-testid="button-cancel-schedule"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={saveMutation.isPending}
                            className="h-12 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-xl px-8 transition-all active:scale-95"
                            data-testid="button-submit-schedule"
                        >
                            {saveMutation.isPending
                                ? (editingSchedule ? 'Saving…' : 'Creating…')
                                : (editingSchedule ? 'Save changes' : 'Create automation')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </PageShell>
        </ErrorBoundary>
    );
}
