
import { MessagePayload, MessageSeverity, messagingService } from "../../domain/integrations/messaging-service.js";

export async function handleSendNotification(params: any) {
    const payload: MessagePayload = {
        title: params.title,
        body: params.body,
        severity: params.severity as MessageSeverity,
        actions: params.actions
    };

    const results = await messagingService.notify(payload);
    return {
        success: true,
        summary: `Notification sent to ${results.length} providers`,
        details: results
    };
}

