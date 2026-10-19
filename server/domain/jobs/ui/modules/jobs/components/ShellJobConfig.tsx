import React from "react";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Input } from "@domain-ui/core/ui/components/ui/input";

interface ShellJobConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function ShellJobConfig({
    config,
    onChange,
}: ShellJobConfigProps) {
    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="shell-executable">Executable / Command *</Label>
                <p className="text-xs text-muted-foreground">
                    The command or script to execute (e.g., /bin/bash, cmd.exe, node, or a script path)
                </p>
                <Input
                    id="shell-executable"
                    value={config.executable || ""}
                    onChange={(e) =>
                        onChange({ ...config, executable: e.target.value })
                    }
                    placeholder="/bin/bash"
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="shell-parameters">Parameters / Arguments</Label>
                <p className="text-xs text-muted-foreground">
                    Command line arguments to pass to the executable (supports variable substitution)
                </p>
                <Input
                    id="shell-parameters"
                    value={config.parameters || ""}
                    onChange={(e) =>
                        onChange({ ...config, parameters: e.target.value })
                    }
                    placeholder="--input {{input}}"
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="shell-working-directory">Working Directory</Label>
                <p className="text-xs text-muted-foreground">
                    Optional directory to run the command from
                </p>
                <Input
                    id="shell-working-directory"
                    value={config.workingDirectory || ""}
                    onChange={(e) =>
                        onChange({ ...config, workingDirectory: e.target.value })
                    }
                    placeholder="/path/to/working/directory"
                />
            </div>
        </div>
    );
}
