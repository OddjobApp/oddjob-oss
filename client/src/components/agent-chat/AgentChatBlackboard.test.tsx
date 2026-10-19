import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentChatBlackboard } from "./AgentChatBlackboard";

describe("AgentChatBlackboard", () => {
    it("disables recording until the room exists", () => {
        const onCreate = vi.fn();
        render(
            <AgentChatBlackboard
                roomOpen={false}
                recordKind="decision"
                setRecordKind={vi.fn()}
                recordText="ship it"
                setRecordText={vi.fn()}
                onCreateRecord={onCreate}
                onChangeRoomMode={vi.fn()}
            />
        );

        expect(screen.getByTestId("crew-room-mode")).toBeDisabled();
        expect(screen.getByTestId("blackboard-record-text")).toBeDisabled();
        expect(screen.getByTestId("blackboard-record-submit")).toBeDisabled();
        expect(screen.getByTestId("blackboard-room-closed-hint")).toBeInTheDocument();

        fireEvent.keyDown(screen.getByTestId("blackboard-record-text"), { key: "Enter" });
        expect(onCreate).not.toHaveBeenCalled();
    });

    it("records once the room is open", () => {
        const onCreate = vi.fn();
        const onChangeRoomMode = vi.fn();
        render(
            <AgentChatBlackboard
                recordKind="decision"
                setRecordKind={vi.fn()}
                recordText="ship it"
                setRecordText={vi.fn()}
                onCreateRecord={onCreate}
                onChangeRoomMode={onChangeRoomMode}
            />
        );

        expect(screen.getByTestId("crew-room-mode")).toBeEnabled();
        expect(screen.getByTestId("blackboard-record-text")).toBeEnabled();
        expect(screen.getByTestId("blackboard-record-submit")).toBeEnabled();
        expect(screen.queryByTestId("blackboard-room-closed-hint")).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId("blackboard-record-submit"));
        expect(onCreate).toHaveBeenCalledTimes(1);

        fireEvent.change(screen.getByTestId("crew-room-mode"), { target: { value: "decide" } });
        expect(onChangeRoomMode).toHaveBeenCalledWith("decide");
    });
});
