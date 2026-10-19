import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  crewMeetingSchedulerService,
  type ProposeMeetingParams,
} from "../core/crew-meeting-scheduler.service.js";
import { db } from "@server/database_service.js";

describe("CREW Multi-Participant Meeting Scheduler Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("proposeMeeting", () => {
    it("creates a meeting schedule record with candidate slots and returns crew_scheduling_poll artifact", async () => {
      const mockSchedule = {
        id: 101,
        organizationId: 1,
        projectId: 5,
        title: "Sprint Planning & Agent Review",
        agenda: "Review API refactor and assign DevOps rollout tasks.",
        status: "proposed",
        hostUserId: "user-alice",
        candidateSlots: [
          {
            id: "slot-1",
            startsAt: "2026-08-25T14:00:00.000Z",
            endsAt: "2026-08-25T15:00:00.000Z",
            votes: [],
          },
          {
            id: "slot-2",
            startsAt: "2026-08-26T14:00:00.000Z",
            endsAt: "2026-08-26T15:00:00.000Z",
            votes: [],
          },
        ],
        requestedAttendees: [
          { id: "user-alice", type: "user", name: "Alice", status: "accepted" },
          { id: "user-bob", type: "user", name: "Bob", email: "bob@oddjob.app", status: "invited" },
          { id: "12", type: "agent", name: "DevOpsAgent", status: "accepted" },
        ],
        reminderMinutesBefore: 15,
        createdSessionKey: null,
        bullmqJobId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockInsert = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation(() => ({
          returning: vi.fn().mockResolvedValue([mockSchedule]),
        })),
      }));

      vi.spyOn(db, "insert").mockImplementation(mockInsert as any);

      const params: ProposeMeetingParams = {
        projectId: 5,
        title: "Sprint Planning & Agent Review",
        agenda: "Review API refactor and assign DevOps rollout tasks.",
        hostUserId: "user-alice",
        candidateSlots: [
          { startsAt: "2026-08-25T14:00:00.000Z", endsAt: "2026-08-25T15:00:00.000Z" },
          { startsAt: "2026-08-26T14:00:00.000Z", endsAt: "2026-08-26T15:00:00.000Z" },
        ],
        requestedAttendees: [
          { id: "user-alice", type: "user", name: "Alice" },
          { id: "user-bob", type: "user", name: "Bob", email: "bob@oddjob.app" },
          { id: "12", type: "agent", name: "DevOpsAgent" },
        ],
      };

      const result = await crewMeetingSchedulerService.proposeMeeting(1, params);

      expect(result.schedule.id).toBe(101);
      expect(result.schedule.status).toBe("proposed");
      expect(result.artifact.tool).toBe("propose_meeting_schedule");
      expect(result.artifact.payload.type).toBe("crew_scheduling_poll");
      expect(result.artifact.payload.title).toBe("Sprint Planning & Agent Review");
      expect(result.artifact.payload.requestedAttendees.find((a: any) => a.name === "DevOpsAgent")?.status).toBe("accepted");
    });
  });

  describe("generateIcs", () => {
    it("formats a valid RFC 5545 iCalendar string with attendees and timestamps", () => {
      const schedule = {
        id: 202,
        organizationId: 1,
        projectId: 3,
        title: "Security & Governance Review",
        agenda: "Audit active agent capabilities and set budget limits.",
        status: "confirmed" as const,
        hostUserId: "user-charlie",
        candidateSlots: [],
        confirmedSlot: {
          startsAt: "2026-09-01T15:00:00.000Z",
          endsAt: "2026-09-01T16:00:00.000Z",
        },
        requestedAttendees: [
          { id: "user-charlie", type: "user" as const, name: "Charlie", email: "charlie@oddjob.app", status: "accepted" as const },
          { id: "5", type: "agent" as const, name: "GovernorAgent", status: "accepted" as const },
        ],
        createdSessionKey: null,
        reminderMinutesBefore: 15,
        bullmqJobId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ics = crewMeetingSchedulerService.generateIcs(schedule);

      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain("VERSION:2.0");
      expect(ics).toContain("BEGIN:VEVENT");
      expect(ics).toContain("SUMMARY:Security & Governance Review");
      expect(ics).toContain("DESCRIPTION:Audit active agent capabilities and set budget limits.");
      expect(ics).toContain("ATTENDEE;CN=Charlie;ROLE=REQ-PARTICIPANT:mailto:charlie@oddjob.app");
      expect(ics).toContain("STATUS:CONFIRMED");
      expect(ics).toContain("END:VEVENT");
      expect(ics).toContain("END:VCALENDAR");
    });
  });

  describe("confirmMeeting", () => {
    it("locks in confirmed slot, inserts project event, and produces confirmed artifact", async () => {
      const schedule = {
        id: 303,
        organizationId: 1,
        projectId: 8,
        title: "Quarterly Strategy Sync",
        agenda: "Multi-agent alignment.",
        status: "proposed" as const,
        hostUserId: "user-dan",
        candidateSlots: [
          { id: "slot-A", startsAt: "2026-09-10T10:00:00.000Z", endsAt: "2026-09-10T11:00:00.000Z", votes: ["user-dan"] },
        ],
        confirmedSlot: null,
        requestedAttendees: [{ id: "user-dan", type: "user" as const, name: "Dan", status: "accepted" as const }],
        createdSessionKey: null,
        reminderMinutesBefore: 15,
        bullmqJobId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const confirmedSchedule = {
        ...schedule,
        status: "confirmed" as const,
        confirmedSlot: { startsAt: "2026-09-10T10:00:00.000Z", endsAt: "2026-09-10T11:00:00.000Z" },
      };

      vi.spyOn(db, "select").mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([schedule]),
          }),
        }),
      }) as any);

      vi.spyOn(db, "update").mockImplementation(() => ({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([confirmedSchedule]),
          }),
        }),
      }) as any);

      const mockInsert = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockResolvedValue([]),
      }));
      vi.spyOn(db, "insert").mockImplementation(mockInsert as any);

      const result = await crewMeetingSchedulerService.confirmMeeting(1, 303, "slot-A", "user-dan");

      expect(result.schedule.status).toBe("confirmed");
      expect(result.artifact.payload.type).toBe("crew_meeting_confirmed");
      expect(result.artifact.payload.icsDownloadUrl).toBe("/api/crew/schedules/303/ics");
      expect(result.icsContent).toContain("SUMMARY:Quarterly Strategy Sync");
    });
  });

  describe("launchScheduledMeeting", () => {
    it("provisions CREW room, seeds agent roster, and posts opening agenda turn", async () => {
      const schedule = {
        id: 404,
        organizationId: 1,
        projectId: 2,
        title: "Incident Post-Mortem",
        agenda: "Examine outage root cause and remediation steps.",
        status: "confirmed" as const,
        hostUserId: "user-eve",
        candidateSlots: [],
        confirmedSlot: { startsAt: "2026-08-18T16:00:00.000Z", endsAt: "2026-08-18T17:00:00.000Z" },
        requestedAttendees: [
          { id: "10", type: "agent" as const, name: "SREAgent", status: "accepted" as const },
          { id: "user-eve", type: "user" as const, name: "Eve", status: "accepted" as const },
        ],
        createdSessionKey: null,
        reminderMinutesBefore: 15,
        bullmqJobId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const newSession = {
        id: 999,
        sessionKey: "crew-sched-404-12345",
        organizationId: 1,
        projectId: 2,
        title: "Incident Post-Mortem",
      };

      const openingTurn = {
        id: 1,
        sessionId: 999,
        speakerType: "supervisor",
        content: "Welcome to the scheduled meeting: Incident Post-Mortem",
      };

      vi.spyOn(db, "select").mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([schedule]),
          }),
        }),
      }) as any);

      vi.spyOn(db, "insert").mockImplementation((table: any) => ({
        values: vi.fn().mockImplementation((val: any) => ({
          returning: vi.fn().mockResolvedValue(
            table?._?.name === "crew_sessions" ? [newSession] : [openingTurn]
          ),
          onConflictDoNothing: vi.fn().mockResolvedValue([]),
        })),
      }) as any);

      vi.spyOn(db, "update").mockImplementation(() => ({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }) as any);

      const result = await crewMeetingSchedulerService.launchScheduledMeeting(404);

      expect(result.sessionKey).toContain("crew-sched-404");
      expect(result.turn.content).toContain("Incident Post-Mortem");
    });
  });
});
