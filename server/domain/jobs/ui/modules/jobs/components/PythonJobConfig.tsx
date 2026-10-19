import React from "react";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";

interface PythonJobConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function PythonJobConfig({
    config,
    onChange,
}: PythonJobConfigProps) {
    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="python-script">Python Script *</Label>
                <p className="text-xs text-muted-foreground">
                    Write your Python script here. Can use standard libraries.
                </p>
                <Textarea
                    id="python-script"
                    value={config.scriptContent || ""}
                    onChange={(e) =>
                        onChange({ ...config, scriptContent: e.target.value })
                    }
                    placeholder="print('Hello World')"
                    rows={15}
                    className="font-mono text-sm"
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="python-requirements">Requirements (pip)</Label>
                <p className="text-xs text-muted-foreground">
                    List dependencies, one per line (e.g. requests==2.28.1).
                    Note: Currently these are NOT automatically installed in the simple runner.
                </p>
                <Textarea
                    id="python-requirements"
                    value={config.requirements || ""}
                    onChange={(e) =>
                        onChange({ ...config, requirements: e.target.value })
                    }
                    placeholder="requests"
                    rows={5}
                    className="font-mono text-sm"
                />
            </div>
        </div>
    );
}
