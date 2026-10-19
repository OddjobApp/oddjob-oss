import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Loader2, Plus, Trash2, User, Mail } from "lucide-react";
import type { HumanApprovalConfig, HumanApprovalApprover } from "@shared/schema";
import { Card, CardContent } from "@domain-ui/core/ui/components/ui/card";

interface HilForm {
    id: number;
    name: string;
}

interface UserSummary {
    id: string;
    username: string;
    email: string;
    firstName: string;
    lastName: string;
}

interface HumanApprovalJobConfigProps {
    config: HumanApprovalConfig;
    onChange: (config: HumanApprovalConfig) => void;
}

export default function HumanApprovalJobConfig({
    config,
    onChange,
}: HumanApprovalJobConfigProps) {
    const { data: forms, isLoading: isLoadingForms } = useQuery<HilForm[]>({
        queryKey: ["/api/forms"],
        queryFn: async () => {
            const res = await fetch("/api/forms");
            if (!res.ok) throw new Error("Failed to fetch forms");
            return res.json();
        },
    });

    const { data: users, isLoading: isLoadingUsers } = useQuery<UserSummary[]>({
        queryKey: ["/api/users"],
        queryFn: async () => {
            const res = await fetch("/api/users");
            if (!res.ok) throw new Error("Failed to fetch users");
            return res.json();
        },
    });

    const handleChange = (key: keyof HumanApprovalConfig, value: any) => {
        onChange({
            ...config,
            [key]: value,
        });
    };

    const addApprover = () => {
        const currentApprovers = config.approvers || [];
        // If legacy assigneeEmail exists, maybe migrate it first? 
        // Or just append new ones. 
        handleChange("approvers", [...currentApprovers, { type: 'internal', id: '' }]);
    };

    const removeApprover = (index: number) => {
        const currentApprovers = config.approvers || [];
        handleChange("approvers", currentApprovers.filter((_, i) => i !== index));
    };

    const updateApprover = (index: number, field: keyof HumanApprovalApprover, value: any) => {
        const currentApprovers = [...(config.approvers || [])];
        currentApprovers[index] = { ...currentApprovers[index], [field]: value };

        // Clear ID/Email if type switches
        if (field === 'type') {
            currentApprovers[index].id = '';
            currentApprovers[index].email = '';
        }

        handleChange("approvers", currentApprovers);
    };

    if (isLoadingForms || isLoadingUsers) {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading configuration data...
            </div>
        );
    }

    // Initialize approvers from legacy if needed (one-time migration in UI state?)
    // Better to just treat assigneeEmail as legacy fallback but prefer approvers.

    return (
        <div className="space-y-6">
            <div className="grid gap-2">
                <Label htmlFor="formId">Human Approval Form</Label>
                <Select
                    value={config.formId?.toString() || ""}
                    onValueChange={(val) => handleChange("formId", parseInt(val))}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Select a form" />
                    </SelectTrigger>
                    <SelectContent>
                        {Array.isArray(forms) && forms.map((form) => (
                            <SelectItem key={form.id} value={form.id.toString()}>
                                {form.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                    The form that will be presented to the approver.
                </p>
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label>Approvers</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addApprover}>
                        <Plus className="h-3 w-3 mr-1" /> Add Approver
                    </Button>
                </div>

                {(!config.approvers || config.approvers.length === 0) && !config.assigneeEmail && (
                    <div className="text-sm text-muted-foreground italic border border-dashed rounded p-4 text-center">
                        No approvers configured.
                    </div>
                )}

                {/* Legacy Support Warning/Display */}
                {config.assigneeEmail && (!config.approvers || config.approvers.length === 0) && (
                    <Card className="bg-yellow-50 border-yellow-200">
                        <CardContent className="p-3 flex justify-between items-center text-sm text-yellow-800">
                            <span>Legacy Assignment: <strong>{config.assigneeEmail}</strong></span>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs hover:bg-yellow-100"
                                onClick={() => {
                                    handleChange("approvers", [{ type: 'external', email: config.assigneeEmail }]);
                                    handleChange("assigneeEmail", null);
                                }}
                            >
                                Migrate to List
                            </Button>
                        </CardContent>
                    </Card>
                )}

                <div className="space-y-2">
                    {(config.approvers || []).map((approver, index) => {
                        if (!approver) return null;
                        return (
                            <div key={index} className="flex gap-2 items-start">
                                <Select
                                    value={approver.type || "internal"}
                                    onValueChange={(val: any) => updateApprover(index, 'type', val)}
                                >
                                    <SelectTrigger className="w-[130px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="internal"><div className="flex items-center"><User className="h-3 w-3 mr-2" /> User</div></SelectItem>
                                        <SelectItem value="external"><div className="flex items-center"><Mail className="h-3 w-3 mr-2" /> Email</div></SelectItem>
                                    </SelectContent>
                                </Select>

                                <div className="flex-1">
                                    {approver.type === 'internal' ? (
                                        <Select
                                            value={approver.id || ""}
                                            onValueChange={(val) => updateApprover(index, 'id', val)}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select User" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Array.isArray(users) && users.map((u) => (
                                                    <SelectItem key={u.id} value={u.id}>
                                                        {u.firstName} {u.lastName} ({u.username})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <Input
                                            value={approver.email || ""}
                                            onChange={(e) => updateApprover(index, 'email', e.target.value)}
                                            placeholder="approver@example.com"
                                        />
                                    )}
                                </div>

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-muted-foreground hover:text-red-500"
                                    onClick={() => removeApprover(index)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="grid gap-2">
                <Label htmlFor="policy">Approval Policy</Label>
                <Select
                    value={config.policy || "any"}
                    onValueChange={(val: any) => handleChange("policy", val)}
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="any">Any Approver (First Response Decides)</SelectItem>
                        <SelectItem value="all">Require All Approvers</SelectItem>
                    </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                    Determines how multiple approvers are handled.
                </p>
            </div>

            <div className="grid gap-2">
                <Label htmlFor="timeoutHours">Timeout (Hours)</Label>
                <Input
                    id="timeoutHours"
                    type="number"
                    min={1}
                    value={config.timeoutHours || 24}
                    onChange={(e) => handleChange("timeoutHours", parseInt(e.target.value))}
                />
            </div>
        </div >
    );
}
