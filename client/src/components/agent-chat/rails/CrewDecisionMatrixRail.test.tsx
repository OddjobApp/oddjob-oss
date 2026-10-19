import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CrewDecisionMatrixRail, DecisionMatrixPayload } from "./CrewDecisionMatrixRail";

const mockPayload: DecisionMatrixPayload = {
    topic: "Message Broker Architecture",
    candidates: [
        {
            id: "opt_kafka",
            name: "Apache Kafka",
            description: "High-throughput event streaming",
            scores: { throughput: 9, latency: 8, cost: 6 },
            overallScore: 8.2,
            pros: ["Massive scale", "Durable replay"],
            cons: ["Operational complexity"],
        },
        {
            id: "opt_redis",
            name: "Redis Streams",
            description: "In-memory lightweight stream",
            scores: { throughput: 7, latency: 9, cost: 8 },
            overallScore: 7.8,
            pros: ["Ultra low latency", "Simpler ops"],
            cons: ["RAM cost at scale"],
        },
    ],
    criteria: [
        { key: "throughput", label: "Throughput", weight: 2.0 },
        { key: "latency", label: "Latency", weight: 1.5 },
        { key: "cost", label: "Cost", weight: 1.0 },
    ],
    personaStances: [
        { agentName: "Architect", preferredCandidateId: "opt_kafka", confidence: 90, rationale: "Replayability needed" },
        { agentName: "CFO", preferredCandidateId: "opt_redis", confidence: 80, rationale: "Cheaper upfront" },
    ],
    recommendedCandidateId: "opt_kafka",
    consensusPercentage: 85,
};

describe("CrewDecisionMatrixRail", () => {
    it("renders topic, consensus percentage, and candidate leaderboard", () => {
        render(<CrewDecisionMatrixRail data={mockPayload} />);

        expect(screen.getByTestId("crew-decision-matrix-rail")).toBeInTheDocument();
        expect(screen.getByText("Message Broker Architecture")).toBeInTheDocument();
        expect(screen.getByText("85%")).toBeInTheDocument();
        expect(screen.getAllByText(/Apache Kafka/i).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(/Redis Streams/i).length).toBeGreaterThanOrEqual(1);
    });

    it("renders criteria scorecard breakdown and persona positions", () => {
        render(<CrewDecisionMatrixRail data={mockPayload} />);

        expect(screen.getByText(/Apache Kafka Scorecard/i)).toBeInTheDocument();
        expect(screen.getByText("Throughput")).toBeInTheDocument();
        expect(screen.getByText("@Architect")).toBeInTheDocument();
        expect(screen.getByText("90% conf")).toBeInTheDocument();
    });

    it("triggers onAdoptRecommendation when Adopt Option is clicked", () => {
        const onAdopt = vi.fn();
        render(<CrewDecisionMatrixRail data={mockPayload} onAdoptRecommendation={onAdopt} />);

        const adoptBtn = screen.getByRole("button", { name: /Adopt Option/i });
        fireEvent.click(adoptBtn);

        expect(onAdopt).toHaveBeenCalledTimes(1);
        expect(onAdopt).toHaveBeenCalledWith(expect.objectContaining({ id: "opt_kafka" }));
    });
});
