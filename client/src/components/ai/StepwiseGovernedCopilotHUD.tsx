import React, { useEffect, useState } from "react";

export interface GqeFormPayload {
    formId: string;
    title: string;
    stage: string;
    targetNodeOrFile: string;
    minimalProofContext: {
        lastAttemptedAction?: string;
        detectedRisk?: string;
        safeTransitionScore?: number;
    };
    socraticDisambiguationOptions: Array<{
        optionId: string;
        label: string;
        description: string;
        riskScore: number;
    }>;
    requiredApproverRoles: string[];
}

export interface StepwiseGovernedCopilotHUDProps {
    appId?: string;
    currentStage?: string;
    readinessScore?: number;
    safeTransitionScore?: number;
    subgraphWarmUpMs?: number;
    gqeQuestion?: {
        formAgentPayload: GqeFormPayload;
    };
    onAttestApproval?: (formId: string, optionId: string) => void;
}

const LIFECYCLE_STAGES = [
    "Observe",
    "Diagnose",
    "Improve",
    "Approve",
    "Deploy",
    "Monitor"
];

export const StepwiseGovernedCopilotHUD: React.FC<StepwiseGovernedCopilotHUDProps> = ({
    appId = "oddjob_production",
    currentStage = "Diagnose",
    readinessScore = 85,
    safeTransitionScore = 0.88,
    subgraphWarmUpMs = 2.4,
    gqeQuestion,
    onAttestApproval
}) => {
    const [selectedOption, setSelectedOption] = useState<string>("");
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [attestedSuccess, setAttestedSuccess] = useState<boolean>(false);
    const [countdownSeconds, setCountdownSeconds] = useState<number>(60);
    const [showProofContext, setShowProofContext] = useState<boolean>(false);

    const isBlocked = !!gqeQuestion;

    useEffect(() => {
        if (!isBlocked) return;
        setCountdownSeconds(60);
        const timer = setInterval(() => {
            setCountdownSeconds(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [isBlocked]);

    const handleAttest = async () => {
        if (!gqeQuestion || !selectedOption) return;
        setIsSubmitting(true);

        try {
            const res = await fetch("/api/agent-copilot/attestation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    formId: gqeQuestion.formAgentPayload.formId,
                    decision: selectedOption,
                    attestationSignature: `sig_ui_user_${Date.now()}`,
                    approverRole: gqeQuestion.formAgentPayload.requiredApproverRoles[0] || "operations-supervisor"
                })
            });

            if (res.ok) {
                setAttestedSuccess(true);
                if (onAttestApproval) {
                    onAttestApproval(gqeQuestion.formAgentPayload.formId, selectedOption);
                }
            }
        } catch (err) {
            console.error("Attestation failed", err);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div style={{
            background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
            borderRadius: "16px",
            border: "1px solid rgba(99, 102, 241, 0.2)",
            padding: "24px",
            color: "#f8fafc",
            fontFamily: "Inter, system-ui, -apple-system, sans-serif",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3)"
        }}>
            {/* TOP HEADER & BADGES */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                            color: "#818cf8",
                            background: "rgba(99, 102, 241, 0.15)",
                            padding: "4px 8px",
                            borderRadius: "6px"
                        }}>
                            5-Layer AI Control Plane
                        </span>
                        <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                            App: <strong>{appId}</strong>
                        </span>
                    </div>
                    <h3 style={{ margin: "6px 0 0 0", fontSize: "20px", fontWeight: 700, color: "#ffffff" }}>
                        Stepwise Governed Agent HUD
                    </h3>
                </div>

                <div style={{ display: "flex", gap: "12px" }}>
                    <div style={{
                        background: "rgba(30, 41, 59, 0.8)",
                        border: "1px solid rgba(148, 163, 184, 0.2)",
                        padding: "8px 14px",
                        borderRadius: "10px",
                        textAlign: "center"
                    }}>
                        <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase" }}>Readiness Score</div>
                        <div style={{ fontSize: "16px", fontWeight: 800, color: readinessScore > 75 ? "#34d399" : "#fbbf24" }}>
                            {readinessScore}/100
                        </div>
                    </div>

                    <div style={{
                        background: "rgba(30, 41, 59, 0.8)",
                        border: "1px solid rgba(148, 163, 184, 0.2)",
                        padding: "8px 14px",
                        borderRadius: "10px",
                        textAlign: "center"
                    }}>
                        <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase" }}>Graph Warm-up</div>
                        <div style={{ fontSize: "16px", fontWeight: 800, color: "#60a5fa" }}>
                            {subgraphWarmUpMs}ms
                        </div>
                    </div>
                </div>
            </div>

            {/* LIFECYCLE STAGE STEPPER */}
            <div style={{
                display: "flex",
                gap: "8px",
                marginBottom: "24px",
                background: "rgba(15, 23, 42, 0.6)",
                padding: "8px",
                borderRadius: "12px",
                border: "1px solid rgba(255, 255, 255, 0.05)"
            }}>
                {LIFECYCLE_STAGES.map((stage) => {
                    const isActive = stage.toLowerCase() === currentStage.toLowerCase();
                    return (
                        <div key={stage} style={{
                            flex: 1,
                            padding: "8px 12px",
                            borderRadius: "8px",
                            fontSize: "12px",
                            fontWeight: isActive ? 700 : 500,
                            textAlign: "center",
                            background: isActive
                                ? "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)"
                                : "transparent",
                            color: isActive ? "#ffffff" : "#64748b",
                            transition: "all 0.2s ease"
                        }}>
                            {stage}
                        </div>
                    );
                })}
            </div>

            {/* TRAJECTORY EVALUATOR SCORE & RISK BAR */}
            <div style={{
                background: "rgba(30, 41, 59, 0.5)",
                borderRadius: "12px",
                padding: "16px",
                marginBottom: "20px",
                border: "1px solid rgba(255, 255, 255, 0.08)"
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span style={{ fontSize: "13px", color: "#cbd5e1", fontWeight: 600 }}>
                        Bayesian Trajectory Score \(T(S_{`{next}`})\)
                    </span>
                    <span style={{
                        fontSize: "14px",
                        fontWeight: 800,
                        color: safeTransitionScore >= 0.85 ? "#34d399" : isBlocked ? "#f87171" : "#fbbf24"
                    }}>
                        {(safeTransitionScore * 100).toFixed(1)}% {safeTransitionScore >= 0.85 ? "(Auto-Permitted)" : "(Governance Review Required)"}
                    </span>
                </div>
                <div style={{
                    height: "8px",
                    width: "100%",
                    background: "rgba(15, 23, 42, 0.8)",
                    borderRadius: "4px",
                    overflow: "hidden"
                }}>
                    <div style={{
                        height: "100%",
                        width: `${Math.min(100, safeTransitionScore * 100)}%`,
                        background: safeTransitionScore >= 0.85
                            ? "linear-gradient(90deg, #10b981, #34d399)"
                            : "linear-gradient(90deg, #f43f5e, #fbbf24)",
                        borderRadius: "4px",
                        transition: "width 0.4s ease"
                    }} />
                </div>
            </div>

            {/* GQE FORM AGENT HIL ATTESTATION CARD */}
            {isBlocked && gqeQuestion && (
                <div style={{
                    background: "linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.15) 100%)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    borderRadius: "14px",
                    padding: "20px",
                    marginTop: "16px"
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                        <span style={{
                            background: "#ef4444",
                            color: "#ffffff",
                            padding: "4px 10px",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: 800
                        }}>
                            GQE ATTESTATION REQUIRED
                        </span>
                        <h4 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
                            {gqeQuestion.formAgentPayload.title}
                        </h4>
                    </div>

                    {/* PROOF CONTEXT */}
                    <div style={{
                        background: "rgba(15, 23, 42, 0.8)",
                        padding: "12px",
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: "#94a3b8",
                        marginBottom: "16px",
                        borderLeft: "3px solid #f87171"
                    }}>
                        <div><strong>Target Boundary:</strong> {gqeQuestion.formAgentPayload.targetNodeOrFile}</div>
                        <div><strong>Risk Finding:</strong> {gqeQuestion.formAgentPayload.minimalProofContext.detectedRisk || "Risk score below safety threshold."}</div>
                        <div><strong>Required Approver Role:</strong> {gqeQuestion.formAgentPayload.requiredApproverRoles.join(", ")}</div>
                    </div>

                    {/* SOCRATIC OPTIONS */}
                    {!attestedSuccess ? (
                        <div>
                            <div style={{ fontSize: "13px", fontWeight: 600, color: "#f1f5f9", marginBottom: "10px" }}>
                                Select Socratic Governance Resolution:
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                                {gqeQuestion.formAgentPayload.socraticDisambiguationOptions.map((opt) => (
                                    <label key={opt.optionId} style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: "10px",
                                        padding: "10px 14px",
                                        borderRadius: "8px",
                                        background: selectedOption === opt.label ? "rgba(99, 102, 241, 0.2)" : "rgba(30, 41, 59, 0.6)",
                                        border: selectedOption === opt.label ? "1px solid #6366f1" : "1px solid rgba(255, 255, 255, 0.05)",
                                        cursor: "pointer"
                                    }}>
                                        <input
                                            type="radio"
                                            name="gqeOption"
                                            value={opt.label}
                                            checked={selectedOption === opt.label}
                                            onChange={() => setSelectedOption(opt.label)}
                                            style={{ marginTop: "3px" }}
                                        />
                                        <div>
                                            <div style={{ fontSize: "13px", fontWeight: 700, color: "#ffffff" }}>{opt.label}</div>
                                            <div style={{ fontSize: "11px", color: "#94a3b8" }}>{opt.description}</div>
                                        </div>
                                    </label>
                                ))}
                            </div>

                            <button
                                onClick={handleAttest}
                                disabled={!selectedOption || isSubmitting}
                                style={{
                                    width: "100%",
                                    padding: "12px",
                                    borderRadius: "10px",
                                    background: selectedOption ? "linear-gradient(135deg, #10b981 0%, #059669 100%)" : "rgba(148, 163, 184, 0.2)",
                                    color: "#ffffff",
                                    fontWeight: 700,
                                    border: "none",
                                    cursor: selectedOption ? "pointer" : "not-allowed",
                                    transition: "all 0.2s ease"
                                }}
                            >
                                {isSubmitting ? "Submitting Supervisor Attestation..." : "Submit FormAgent Attestation & Unblock Execution"}
                            </button>
                        </div>
                    ) : (
                        <div style={{
                            background: "rgba(16, 185, 129, 0.2)",
                            border: "1px solid #10b981",
                            borderRadius: "10px",
                            padding: "14px",
                            color: "#34d399",
                            fontWeight: 700,
                            textAlign: "center"
                        }}>
                            ✓ Supervisor Attestation Confirmed. Agent trajectory unblocked for execution!
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default StepwiseGovernedCopilotHUD;
