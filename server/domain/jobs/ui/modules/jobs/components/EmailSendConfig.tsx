import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import type { EmailSendConfig, Credential } from "@shared/schema";

interface EmailSendConfigProps {
    config: EmailSendConfig;
    onChange: (config: EmailSendConfig) => void;
    credentials: Credential[];
}

export default function EmailSendConfig({ config, onChange, credentials }: EmailSendConfigProps) {
    const smtpCredentials = credentials.filter(c => c.type === "smtp");

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>SMTP Credential</Label>
                <Select
                    value={config.credentialId?.toString() || undefined}
                    onValueChange={(val) => onChange({ ...config, credentialId: parseInt(val) })}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Select SMTP Credential" />
                    </SelectTrigger>
                    <SelectContent>
                        {smtpCredentials.map((c) => (
                            <SelectItem key={c.id} value={c.id.toString()}>
                                {c.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label>To</Label>
                <Input
                    value={config.to || ""}
                    onChange={(e) => onChange({ ...config, to: e.target.value })}
                    placeholder="recipient@example.com"
                />
            </div>

            <div className="space-y-2">
                <Label>Subject</Label>
                <Input
                    value={config.subject || ""}
                    onChange={(e) => onChange({ ...config, subject: e.target.value })}
                    placeholder="Email Subject"
                />
            </div>

            <div className="flex items-center space-x-2">
                <Switch
                    id="is-html"
                    checked={config.isHtml}
                    onCheckedChange={(checked) => onChange({ ...config, isHtml: checked })}
                />
                <Label htmlFor="is-html">Send as HTML</Label>
            </div>

            <div className="space-y-2">
                <Label>Body</Label>
                <Textarea
                    value={config.body || ""}
                    onChange={(e) => onChange({ ...config, body: e.target.value })}
                    placeholder="Email body content..."
                    rows={6}
                />
            </div>
        </div>
    );
}
