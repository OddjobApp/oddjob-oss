/**
 * Pod Events Contract
 * 
 * Defines the standardized event types used for inter-pod communication.
 * Using these constants ensures type-safety and consistency across the event bus.
 */

export const POD_EVENTS = {
    MISSION: {
        CREATED: "mission.created",
        UPDATED: "mission.updated",
        DELETED: "mission.deleted",
        STARTED: "mission.started",
        COMPLETED: "mission.completed",
        FAILED: "mission.failed",
        RUN_STARTED: "mission.run.started",
        RUN_COMPLETED: "mission.run.completed",
        RUN_FAILED: "mission.run.failed",
        AWAITING_ORDERS: "mission.awaiting_orders",
    },
    APP: {
        DEPLOYED: "app.deployed",
        DELETED: "app.deleted",
        UPDATED: "app.updated",
        WEBHOOK_TRIGGERED: "app.webhook.triggered",
        SESSION_START: "app.session.start",
        SESSION_HEARTBEAT: "app.session.heartbeat",
        SESSION_COMPLETE: "app.session.complete",
    },
    USER: {
        CREATED: "user.created",
        LOGIN_SUCCESS: "user.login_success",
    },
    ORG: {
        CREATED: "org.created",
        SETTINGS_UPDATED: "org.settings_updated",
    },
    KNOWLEDGE: {
        TOPIC_CREATED: "knowledge.topic_created",
        DOCUMENT_INGESTED: "knowledge.document_ingested",
    },
    AGENT: {
        MESSAGE_SENT: "agent.message_sent",
        TASK_DELEGATED: "agent.task_delegated",
        THOUGHT_PUBLISHED: "agent.thought_published",
        INBOX_UPDATED: "agent.inbox_updated",
    },
    CYCLE: {
        CREATED: "cycle.created",
        LAUNCHED: "cycle.launched",
        STATUS_CHANGED: "cycle.status_changed",
        PRIORITY_CHANGED: "cycle.priority_changed",
        MILESTONE_REACHED: "cycle.milestone_reached",
        SLA_AT_RISK: "cycle.sla_at_risk",
        SLA_CRITICAL: "cycle.sla_critical",
        SLA_OVERDUE: "cycle.sla_overdue",
        SPEND_ALERT: "cycle.spend_alert",
        HIL_REQUESTED: "cycle.hil_requested",
        HIL_RESOLVED: "cycle.hil_resolved",
        CLOSED: "cycle.closed",
    },
    INFRA: {
        SCALE_UP_REQUESTED: "infra.scale_up_requested",
    }
} as const;

export type PodEventNamespace = keyof typeof POD_EVENTS;
