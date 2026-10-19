import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, resolveActiveOrgId } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { CreateFormDialog, type CreateMode } from '@/modules/forms/CreateFormDialog';
import type { LibraryRow } from '@/modules/forms/pages/FormsLibraryPage';

export function CrewFormPicker({ onSelect }: { onSelect: (id: number) => void }) {
    const [open, setOpen] = useState(false);
    return <><Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Form Studio</Button>
        {open && <CrewFormPickerDialog onSelect={onSelect} onClose={() => setOpen(false)} />}</>;
}

function CrewFormPickerDialog({ onSelect, onClose }: { onSelect: (id: number) => void; onClose: () => void }) {
    const open = true;
    const setOpen = (value: boolean) => { if (!value) onClose(); };
    const [creating, setCreating] = useState<CreateMode | null>(null);
    const [search, setSearch] = useState('');
    const [copying, setCopying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const forms = useQuery<LibraryRow[]>({ queryKey: ['/api/form-studio', 'crew-picker', resolveActiveOrgId()], enabled: open,
        queryFn: async () => (await apiRequest('GET', '/api/form-studio')).json() });
    const project = useQuery<{ project: { key: string } | null }>({ queryKey: ['/api/projects/active'], enabled: open });
    const select = (id: number) => { onSelect(id); setOpen(false); setCreating(null); };
    const copy = async (id: number) => {
        setCopying(true); setError(null);
        try { select((await (await apiRequest('POST', `/api/form-studio/${id}/duplicate`, {})).json()).id); }
        catch (err) { setError((err as Error).message); }
        finally { setCopying(false); }
    };
    const matches = (forms.data ?? []).filter(form => !form.isArchived && form.name.toLowerCase().includes(search.toLowerCase()));
    return <>
        <Dialog open={open && !creating} onOpenChange={value => { if (!copying) setOpen(value); }}>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Create or edit a form</DialogTitle><DialogDescription>Open Form Studio beside this CREW conversation.</DialogDescription></DialogHeader>
                <div className="flex flex-wrap gap-2"><Button disabled={copying} onClick={() => setCreating('blank')}>Blank form</Button><Button disabled={copying} variant="outline" onClick={() => setCreating('documents')}>From documents</Button></div>
                <label className="grid gap-1 text-sm">Find an existing form<Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search forms" /></label>
                {(error || forms.error) && <p role="alert" className="text-sm text-destructive">{error || (forms.error as Error).message}</p>}
                {forms.isPending ? <p role="status">Loading forms…</p> : forms.isError ? <Button onClick={() => void forms.refetch()}>Retry</Button> : <ul className="grid gap-2">
                    {matches.map(form => <li key={form.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                        <span className="min-w-0 flex-1 break-words text-sm font-medium">{form.name}</span>
                        <Button size="sm" variant="outline" disabled={copying} onClick={() => select(form.id)} aria-label={`Open ${form.name}`}>Open</Button>
                        <Button size="sm" variant="ghost" disabled={copying} onClick={() => void copy(form.id)} aria-label={`Use ${form.name} as template`}>Use as template</Button>
                    </li>)}
                    {!matches.length && <li className="text-sm text-muted-foreground">No matching forms. Start a blank form or use documents.</li>}
                </ul>}
            </DialogContent>
        </Dialog>
        {creating && <CreateFormDialog mode={creating} open onOpenChange={value => { if (!value) setCreating(null); }} onCreated={form => select(form.id)} projectKey={project.data?.project?.key} />}
    </>;
}
