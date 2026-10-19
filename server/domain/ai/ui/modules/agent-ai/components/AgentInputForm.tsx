import React, { useState } from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@domain-ui/core/ui/components/ui/card';
import { Loader2, Play } from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@domain-ui/core/ui/components/ui/select";
import { LocationInput } from "@domain-ui/core/ui/components/ui/location-input";
import { translateRegexToVerbal } from '@/lib/regex-utils';

export interface InputField {
    name: string;
    label: string;
    type: 'text' | 'number' | 'email' | 'password' | 'location' | 'date' | 'phone' | 'vin' | 'url';
    required: boolean;
    placeholder?: string;
    description?: string;
    pattern?: string;
    patternMessage?: string;
    options?: (string | number)[];
}

export interface InputRequest {
    type: 'input_request';
    nonce: string;  // Secure session-scoped nonce (replaces pipelineId)
    pipelineName: string;
    fields: InputField[];
}

export interface ModeSwitchRequest {
    type: 'mode_switch_request';
    targetMode: 'execute' | 'planning';
    reason: string;
    message?: string;
}

interface AgentInputFormProps {
    request: InputRequest;
    onSubmit: (nonce: string, inputData: Record<string, any>) => void;  // Now uses nonce
    isSubmitting: boolean;
    primaryColor?: string;
}

export function AgentInputForm({ request, onSubmit, isSubmitting, primaryColor = '#3b82f6' }: AgentInputFormProps) {
    console.log('[AgentInputForm] Rendering request:', {
        pipelineName: request.pipelineName,
        fields: request.fields.map(f => ({ name: f.name, type: f.type }))
    });
    const [values, setValues] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});

    const handleChange = (name: string, value: string) => {
        setValues(prev => ({ ...prev, [name]: value }));
        // Clear error on change
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: '' }));
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // Validate required fields
        const newErrors: Record<string, string> = {};
        for (const field of request.fields) {
            if (field.required && !values[field.name]?.trim()) {
                newErrors[field.name] = `${field.label || field.name} is required`;
            }
            // Validate pattern if provided
            if (field.pattern && values[field.name]) {
                const regex = new RegExp(field.pattern);
                if (!regex.test(values[field.name])) {
                    newErrors[field.name] = field.patternMessage || translateRegexToVerbal(field.pattern);
                }
            }
        }

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        onSubmit(request.nonce, values);
    };

    return (
        <Card 
            className="w-full max-w-md border-2 shadow-lg" 
            style={{ 
                '--primary-brand': primaryColor,
                borderColor: `rgba(var(--primary-brand-rgb, 59, 130, 246), 0.25)` 
            } as React.CSSProperties}
        >
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                    <Play className="h-5 w-5" style={{ color: 'var(--primary-brand)' } as React.CSSProperties} />
                    {request.pipelineName}
                </CardTitle>
                <CardDescription>
                    Please provide the required information to run this workflow.
                </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
                <CardContent className="space-y-4">
                    {request.fields.map((field) => (
                        <div key={field.name} className="space-y-2">
                            <Label htmlFor={field.name} className="flex items-center gap-1">
                                {field.label || field.name}
                                {field.required && <span className="text-red-500">*</span>}
                            </Label>

                            {field.options && field.options.length > 0 ? (
                                <Select
                                    value={values[field.name] || ""}
                                    onValueChange={(val) => handleChange(field.name, val)}
                                    disabled={isSubmitting}
                                >
                                    <SelectTrigger id={field.name} className={errors[field.name] ? 'border-red-500 ring-red-500' : ''}>
                                        <SelectValue placeholder={field.placeholder || "Select an option"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {field.options.map((opt) => (
                                            <SelectItem key={String(opt)} value={String(opt)}>
                                                {String(opt)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : field.type === 'location' ? (
                                <LocationInput
                                    value={values[field.name] || ''}
                                    onChange={(val) => handleChange(field.name, val)}
                                    placeholder={field.placeholder}
                                    disabled={isSubmitting}
                                    className={errors[field.name] ? 'border-red-500' : ''}
                                />
                            ) : (
                                <Input
                                    id={field.name}
                                    type={field.type}
                                    placeholder={field.placeholder || `Enter ${(field.label || field.name || 'value').toLowerCase()}`}
                                    value={values[field.name] || ''}
                                    onChange={(e) => handleChange(field.name, e.target.value)}
                                    className={errors[field.name] ? 'border-red-500 focus-visible:ring-red-500' : ''}
                                    disabled={isSubmitting}
                                />
                            )}

                            {field.description && !errors[field.name] && (
                                <p className="text-xs text-muted-foreground">{field.description}</p>
                            )}
                            {errors[field.name] && (
                                <p className="text-xs text-red-500 font-medium">{errors[field.name]}</p>
                            )}
                        </div>
                    ))}
                </CardContent>
                <CardFooter>
                    <Button
                        type="submit"
                        className="w-full h-11 font-semibold"
                        style={{ backgroundColor: 'var(--primary-brand)' } as React.CSSProperties}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Running...
                            </>
                        ) : (
                            <>
                                <Play className="h-4 w-4 mr-2" />
                                Run Pipeline
                            </>
                        )}
                    </Button>
                </CardFooter>
            </form>
        </Card>
    );
}

export interface RescueStatusRequest {
    type: 'rescue_status';
    sessionId: number;
}

/** A published Form Studio form shared into the conversation, by its public link token. */
export interface FormStudioFormShare {
    type: 'form_studio_form';
    token: string;
    formName?: string;
    releaseNumber?: number;
}

/**
 * Parse agent response content to detect structured input requests
 */
export function parseAgentResponse(content: string): {
    type: 'text' | 'input_request' | 'mode_switch_request' | 'rescue_status' | 'form_studio_form';
    data: string | InputRequest | ModeSwitchRequest | RescueStatusRequest | FormStudioFormShare
} {
    const trimmed = content.trim();

    // 1. Try to parse as JSON first (exact match)
    try {
        if (trimmed.startsWith('{') && trimmed.includes('"type"')) {
            const parsed = JSON.parse(trimmed);
            if (isValidAgentJson(parsed)) {
                return { type: parsed.type, data: parsed };
            }
        }
    } catch { }

    // 2. Try to find JSON in markdown code blocks
    try {
        const jsonMatch = trimmed.match(/```json\n([\s\S]*?)\n```/) || trimmed.match(/```\n([\s\S]*?)\n```/);
        if (jsonMatch) {
            const raw = jsonMatch[1].trim();
            const parsed = JSON.parse(raw);
            if (isValidAgentJson(parsed)) {
                return { type: parsed.type, data: parsed };
            }
        }
    } catch { }

    // 3. Last ditch: search for any {...} block that looks like our type
    try {
        const bracketMatch = trimmed.match(/\{[\s\S]*"type":\s*"(input_request|mode_switch_request|rescue_status|form_studio_form)"[\s\S]*\}/);
        if (bracketMatch) {
            const parsed = JSON.parse(bracketMatch[0]);
            if (isValidAgentJson(parsed)) {
                return { type: parsed.type, data: parsed };
            }
        }
    } catch { }

    return { type: 'text', data: content };
}

function isValidAgentJson(parsed: any): boolean {
    if (!parsed || typeof parsed !== 'object') return false;
    if (parsed.type === 'input_request' && (parsed.nonce || parsed.pipelineId) && parsed.fields) return true;
    if (parsed.type === 'mode_switch_request' && parsed.targetMode) return true;
    if (parsed.type === 'rescue_status' && parsed.sessionId) return true;
    // The token is the whole of what the page fetches, so only the real shape counts.
    if (parsed.type === 'form_studio_form' && typeof parsed.token === 'string' && /^[a-f0-9]{48}$/.test(parsed.token)) return true;
    return false;
}
