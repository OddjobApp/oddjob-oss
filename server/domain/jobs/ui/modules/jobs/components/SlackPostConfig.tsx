import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import type { SlackPostConfig, Credential } from "@shared/schema";

interface SlackPostConfigProps {
    config: SlackPostConfig;
    onChange: (config: SlackPostConfig) => void;
    credentials: Credential[];
}

export default function SlackPostConfig({ config, onChange, credentials }: SlackPostConfigProps) {
    const slackCredentials = credentials.filter(c => c.type === "api_key" || c.type === "oauth_token");

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>Slack Credential (Bot Token)</Label>
                <Select
                    value={config.credentialId?.toString() || undefined}
                    onValueChange={(val) => onChange({ ...config, credentialId: parseInt(val) })}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Select Slack Credential" />
                    </SelectTrigger>
                    <SelectContent>
                        {slackCredentials.map((c) => (
                            <SelectItem key={c.id} value={c.id.toString()}>
                                {c.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                    Use a credential storing your Slack Bot User OAuth Token (xoxb-...)
                </p>
            </div>

            <div className="space-y-2">
                <Label>Channel ID</Label>
                <Input
                    value={config.channelId || ""}
                    onChange={(e) => onChange({ ...config, channelId: e.target.value })}
                    placeholder="C12345678 or #channel-name"
                />
            </div>

            <div className="space-y-2">
                <Label>Message Text</Label>
                <Textarea
                    value={config.message || ""}
                    onChange={(e) => onChange({ ...config, message: e.target.value })}
                    placeholder="Hello world! (Supports {{variables}})"
                    rows={5}
                />
            </div>
        </div>
    );
}
