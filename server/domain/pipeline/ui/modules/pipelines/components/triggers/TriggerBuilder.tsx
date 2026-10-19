import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { 
  Zap, 
  Trash2, 
  Plus, 
  Settings2, 
  Clock, 
  Layers, 
  ChevronRight,
  ShieldCheck,
  Code
} from 'lucide-react';
import { 
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage 
} from '@domain-ui/core/ui/components/ui/form';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@domain-ui/core/ui/components/ui/select';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { useForm, useFieldArray, Control } from 'react-hook-form';
import { CELConditionBuilder } from '../CELConditionBuilder.js';
import { EVENT_TYPES, CATEGORIES } from './constants.js';
import { motion, AnimatePresence } from 'framer-motion';
import { VariableSelector } from "@domain-ui/core/ui/components/shared/VariableSelector";

interface TriggerBuilderProps {
  pipelineId: number;
}

export default function TriggerBuilder({ pipelineId }: TriggerBuilderProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingTriggerId, setEditingTriggerId] = useState<number | null>(null);

  // Fetch triggers
  const { data: triggers = [], isLoading } = useQuery<any[]>({
    queryKey: [`/api/pipelines/${pipelineId}/triggers`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/pipelines/${pipelineId}/triggers`);
      return res.json();
    }
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/pipelines/${pipelineId}/triggers`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/pipelines/${pipelineId}/triggers`] });
      setIsAdding(false);
      toast({ title: "Trigger Created", description: "Reactive trigger activated." });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number, data: any }) => {
      const res = await apiRequest("PATCH", `/api/pipelines/${pipelineId}/triggers/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/pipelines/${pipelineId}/triggers`] });
      setEditingTriggerId(null);
      toast({ title: "Trigger Updated", description: "Configuration synced." });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/pipelines/${pipelineId}/triggers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/pipelines/${pipelineId}/triggers`] });
      toast({ title: "Trigger Removed", description: "Event link severed." });
    }
  });

  return (
    <div className="space-y-6 font-mono">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tighter text-cyan-400 uppercase italic flex items-center gap-2">
            <Zap className="w-5 h-5 fill-cyan-400" />
            Reactive Triggers
          </h2>
          <p className="text-xs text-muted-foreground mt-1">Configure event-driven pipeline execution</p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          className="border-cyan-500/50 hover:bg-cyan-500/10 text-cyan-400"
          onClick={() => setIsAdding(true)}
          disabled={isAdding || !!editingTriggerId}
        >
          <Plus className="w-4 h-4 mr-1" />
          NEW TRIGGER
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <AnimatePresence>
          {isAdding && (
            <TriggerForm 
              onSave={(data: any) => createMutation.mutate(data)} 
              onCancel={() => setIsAdding(false)} 
              isPending={createMutation.isPending}
            />
          )}
        </AnimatePresence>

        {isLoading ? (
          <div className="p-12 text-center border border-dashed border-muted rounded-lg">
            <div className="animate-pulse text-cyan-500/50">SCANNING CHANNELS...</div>
          </div>
        ) : triggers.length === 0 && !isAdding ? (
          <div className="p-12 text-center border border-dashed border-muted rounded-lg bg-muted/5">
            <Layers className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground uppercase tracking-widest">No active triggers detected</p>
          </div>
        ) : (
          <div className="space-y-3">
            {triggers.map((trigger) => (
              <motion.div
                key={trigger.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {editingTriggerId === trigger.id ? (
                  <TriggerForm 
                    initialData={trigger}
                    onSave={(data: any) => updateMutation.mutate({ id: trigger.id, data })}
                    onCancel={() => setEditingTriggerId(null)}
                    isPending={updateMutation.isPending}
                  />
                ) : (
                  <TriggerCard 
                    trigger={trigger} 
                    onEdit={() => setEditingTriggerId(trigger.id)}
                    onDelete={() => deleteMutation.mutate(trigger.id)}
                    onToggleActive={(isActive: boolean) => updateMutation.mutate({ id: trigger.id, data: { isActive } })}
                  />
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TriggerCard({ trigger, onEdit, onDelete, onToggleActive }: any) {
  const eventInfo = EVENT_TYPES.find(e => e.value === trigger.eventType);

  return (
    <Card className="group relative overflow-hidden border-muted-foreground/20 hover:border-cyan-500/50 transition-colors bg-background/40 backdrop-blur-sm">
      <div className="absolute top-0 left-0 w-1 h-full bg-cyan-500/30" />
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-sm border border-cyan-500/30 flex items-center justify-center bg-cyan-950/20">
            <Zap className={`w-5 h-5 ${trigger.isActive ? 'text-cyan-400 fill-cyan-400/20' : 'text-muted-foreground'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-foreground uppercase tracking-wider">{eventInfo?.label || trigger.eventType}</span>
              <Badge variant="outline" className="text-[10px] h-4 bg-background/50 border-cyan-500/20 text-cyan-400 uppercase">
                {eventInfo?.category || 'Custom'}
              </Badge>
              {!trigger.isActive && (
                <Badge variant="secondary" className="text-[10px] h-4 uppercase">Disabled</Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground uppercase">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {trigger.debounceWindow > 0 ? `${trigger.debounceWindow}s Delay` : 'IMMEDIATE'}
              </span>
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3" />
                {trigger.batchSize > 1 ? `Batch size: ${trigger.batchSize}` : 'Single Fire'}
              </span>
              {trigger.filterCondition && (
                <span className="flex items-center gap-1 text-cyan-400/70">
                  <Code className="w-3 h-3" />
                  Conditional
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Switch 
            checked={trigger.isActive} 
            onCheckedChange={onToggleActive} 
            className="scale-75 data-[state=checked]:bg-cyan-500"
          />
          <Separator orientation="vertical" className="h-6 mx-1 bg-muted-foreground/20" />
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:text-cyan-400" onClick={onEdit}>
            <Settings2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:text-red-400" onClick={onDelete}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TriggerForm({ initialData, onSave, onCancel, isPending }: any) {
  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = useForm({
    defaultValues: initialData || {
      eventType: 'job.drift_detected',
      filterCondition: '',
      debounceWindow: 0,
      batchSize: 1,
      isActive: true,
      description: '',
      actionType: 'pipeline',
      notificationConfig: {
        channel: 'slack',
        target: '',
        template: 'Drift detected in {{payload.pipelineId}}. Score: {{payload.driftScore}}'
      },
      conditions: [] // For visual builder
    }
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "conditions"
  });

  const eventType = watch('eventType');

  const onFormSubmit = (data: any) => {
    // Convert conditions back to a single CEL string if needed, 
    // or just pass the data if the backend handles the array.
    // The current backend uses a single string 'filterCondition'.
    
    let filterCondition = data.filterCondition;
    if (data.conditions && data.conditions.length > 0) {
      // Simple join for now, but usually needs proper CEL formatting
      filterCondition = data.conditions.map((c: any) => 
        `${c.source} ${c.operator} ${typeof c.target === 'string' ? `'${c.target}'` : c.target}`
      ).join(' && ');
    }
    
    onSave({ ...data, filterCondition });
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <Form {...{ register, control, handleSubmit, watch, setValue, formState: { errors } } as any}>
        <form onSubmit={handleSubmit(onFormSubmit)}>
        <Card className="border-cyan-500/50 bg-background/60 shadow-[0_0_20px_rgba(34,211,238,0.1)] relative">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              {initialData ? 'Edit Trigger Configuration' : 'Establish New Event Link'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 pt-2">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Event Selection */}
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-widest">Event Source</Label>
                  <Select 
                    value={eventType} 
                    onValueChange={(v) => setValue('eventType', v)}
                  >
                    <SelectTrigger className="border-cyan-500/30 bg-background/40 h-12 uppercase text-xs font-bold text-cyan-100">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background border-cyan-500/50 max-h-[300px]">
                      {CATEGORIES.map(cat => (
                        <React.Fragment key={cat}>
                          <div className="px-2 py-2 text-[9px] font-bold text-cyan-500/50 uppercase tracking-widest border-b border-foreground/5 mb-1 mt-2">{cat}</div>
                          {EVENT_TYPES.filter(e => e.category === cat).map(type => (
                            <SelectItem key={type.value} value={type.value} className="text-xs uppercase hover:bg-cyan-500/10 focus:bg-cyan-500/20 py-2">
                              {type.label}
                            </SelectItem>
                          ))}
                        </React.Fragment>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="p-3 bg-cyan-500/5 border border-cyan-500/10 rounded">
                    <p className="text-[10px] text-cyan-400/70 italic leading-relaxed">
                      {EVENT_TYPES.find(e => e.value === eventType)?.description}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-widest">Debounce Window</Label>
                    <div className="relative">
                      <Input 
                        type="number" 
                        {...register('debounceWindow', { valueAsNumber: true })}
                        className="border-cyan-500/30 bg-background/40 h-12 text-xs pl-10"
                      />
                      <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-500/50" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground uppercase">SEC</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-widest">Batch Size</Label>
                    <div className="relative">
                      <Input 
                        type="number" 
                        {...register('batchSize', { valueAsNumber: true })}
                        className="border-cyan-500/30 bg-background/40 h-12 text-xs pl-10"
                      />
                      <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-500/50" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground uppercase">EVENTS</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-6 pt-4 border-t border-cyan-500/10">
                   <Label className="text-[10px] text-muted-foreground uppercase tracking-widest">Trigger Action</Label>
                   <div className="grid grid-cols-2 gap-4">
                      <Button 
                        type="button"
                        variant={watch('actionType') === 'pipeline' ? 'default' : 'outline'}
                        className={`h-12 uppercase text-[10px] font-bold tracking-widest ${watch('actionType') === 'pipeline' ? 'bg-cyan-500 text-background' : 'border-cyan-500/30 text-cyan-400'}`}
                        onClick={() => setValue('actionType', 'pipeline')}
                      >
                        Execute Pipeline
                      </Button>
                      <Button 
                        type="button"
                        variant={watch('actionType') === 'notification' ? 'default' : 'outline'}
                        className={`h-12 uppercase text-[10px] font-bold tracking-widest ${watch('actionType') === 'notification' ? 'bg-magenta-500 text-foreground' : 'border-magenta-500/30 text-magenta-400'}`}
                        onClick={() => setValue('actionType', 'notification')}
                      >
                        Send Notification
                      </Button>
                   </div>

                   {watch('actionType') === 'notification' && (
                     <div className="space-y-4 p-4 bg-magenta-500/5 border border-magenta-500/20 rounded-lg animate-in fade-in slide-in-from-top-2">
                        <div className="space-y-2">
                           <Label className="text-[9px] text-magenta-400 uppercase">Channel</Label>
                           <Select 
                             value={watch('notificationConfig.channel')} 
                             onValueChange={(v) => setValue('notificationConfig.channel', v)}
                           >
                             <SelectTrigger className="border-magenta-500/30 bg-background/40 h-8 text-[10px]">
                               <SelectValue />
                             </SelectTrigger>
                             <SelectContent className="bg-background border-magenta-500/50">
                               <SelectItem value="slack" className="text-[10px] uppercase">Slack Webhook</SelectItem>
                               <SelectItem value="email" className="text-[10px] uppercase">Direct Email</SelectItem>
                             </SelectContent>
                           </Select>
                        </div>
                        <div className="space-y-2">
                           <Label className="text-[9px] text-magenta-400 uppercase">Target Address / Webhook</Label>
                           <Input 
                             {...register('notificationConfig.target')}
                             placeholder={watch('notificationConfig.channel') === 'slack' ? 'https://hooks.slack.com/services/...' : 'admin@example.com'}
                             className="border-magenta-500/30 bg-background/40 h-8 text-[10px]"
                           />
                        </div>
                         <div className="space-y-2">
                            <div className="flex items-center justify-between">
                               <Label className="text-[9px] text-magenta-400 uppercase">Message Template</Label>
                               <VariableSelector 
                                 schema={EVENT_TYPES.find(e => e.value === watch('eventType'))?.schema as any}
                                 onSelect={(variable) => {
                                   const current = watch('notificationConfig.template');
                                   setValue('notificationConfig.template', current + ` {{${variable}}}`);
                                 }}
                               />
                            </div>
                            <textarea 
                              {...register('notificationConfig.template')}
                              className="w-full bg-background/40 border border-magenta-500/30 rounded p-2 text-[10px] font-mono min-h-[60px]"
                              placeholder="Use {{payload.field}} for interpolation"
                            />
                            <p className="text-[8px] text-muted-foreground italic">Tip: Use double braces for dynamic fields.</p>
                         </div>
                     </div>
                   )}
                </div>
              </div>

              {/* Condition Builder */}
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-widest">Filter Logic & Constraints</Label>
                  <Button 
                    type="button"
                    variant="ghost" 
                    size="sm" 
                    className="h-6 text-[9px] text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/10"
                    onClick={() => append({ source: '', operator: 'EQ', target: '' })}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    ADD RULE
                  </Button>
                </div>

                <ScrollArea className="h-[250px] pr-4 border border-cyan-500/10 rounded-lg p-2 bg-background/20">
                  <div className="space-y-4">
                    {fields.length === 0 ? (
                      <div className="p-8 text-center border border-dashed border-cyan-500/10 rounded-lg">
                        <Code className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                        <p className="text-[9px] text-muted-foreground uppercase">No filters applied. Trigger will fire on every event.</p>
                      </div>
                    ) : (
                      fields.map((field, index) => (
                        <div key={field.id} className="relative group">
                          <CELConditionBuilder 
                            index={index}
                            control={control}
                            onRemove={() => remove(index)}
                            contextSchema={EVENT_TYPES.find(e => e.value === watch('eventType'))?.schema as any}
                          />
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
                
                {fields.length > 0 && (
                   <div className="p-3 bg-background/40 border border-cyan-500/20 rounded-md">
                      <div className="flex items-center gap-2 mb-1">
                        <Code className="w-3 h-3 text-cyan-400" />
                        <span className="text-[9px] text-cyan-400 uppercase font-bold">Generated CEL String</span>
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground truncate italic">
                        {watch('conditions')?.map((c: any) => `${c.source} ${c.operator} ${c.target}`).join(' && ') || 'None'}
                      </div>
                   </div>
                )}
              </div>
            </div>

            <Separator className="bg-cyan-500/10" />

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button 
                type="button"
                variant="ghost" 
                size="sm" 
                className="text-[10px] uppercase tracking-widest hover:text-foreground"
                onClick={onCancel}
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                size="sm" 
                className="bg-cyan-500 hover:bg-cyan-400 text-background text-[10px] font-bold uppercase tracking-widest px-6"
                disabled={isPending}
              >
                {isPending ? 'SYNCHRONIZING...' : initialData ? 'UPDATE CONFIG' : 'ACTIVATE TRIGGER'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </Form>
  </motion.div>
);
}
