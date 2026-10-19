/**
 * Dead Man's Switch engine (PRD §4.1).
 *
 * Each switch arms an EXPECTED recurring cashflow (e.g. payroll inflow, rent
 * outflow) with a deadline + grace window. If the deadline passes while the
 * switch is still ARMED, it trips to FAULT, a dms_fault recommendation is
 * raised, and downstream safe-to-spend is shielded by the missing floor.
 */

import { RecordStore } from "./record-store.js";
import { FinanceCollections } from "./collections.js";
import { createRecommendation } from "./recommendations.js";

export interface DeadMansSwitch {
    switch_id: string;
    label: string;
    account_id: string;
    expected_direction: "INFLOW" | "OUTFLOW";
    amount_floor: number;
    payee_token: string;
    cron_expected_interval: string;
    grace_period_hours: number;
    status: "ARMED" | "SATISFIED" | "FAULT";
    expiration_deadline: string;
    last_satisfied_at?: string;
}

export interface DmsEvaluation {
    faulted: string[]; // switch_ids that tripped this run
    shieldedAmount: number; // sum of missing floors
    recommendationIds: string[];
}

export async function evaluateSwitches(store: RecordStore, now: Date = new Date()): Promise<DmsEvaluation> {
    const switches = await store.list<DeadMansSwitch>(FinanceCollections.deadMansSwitches);
    const faulted: string[] = [];
    const recommendationIds: string[] = [];
    let shieldedAmount = 0;

    for (const { recordId, data } of switches) {
        if (data.status !== "ARMED") continue;
        const deadline = new Date(data.expiration_deadline);
        if (isNaN(deadline.getTime())) continue;
        // Grace window extends the hard deadline.
        const effectiveDeadline = deadline.getTime() + (data.grace_period_hours || 0) * 3600_000;
        if (now.getTime() <= effectiveDeadline) continue;

        // Trip the switch.
        const updated: DeadMansSwitch = { ...data, status: "FAULT" };
        await store.upsert(FinanceCollections.deadMansSwitches, recordId, updated);
        faulted.push(recordId);
        shieldedAmount += data.amount_floor || 0;

        const rec = await createRecommendation(store, {
            kind: "dms_fault",
            title: `Dead Man's Switch FAULT: ${data.label}`,
            body: `Expected ${data.expected_direction.toLowerCase()} of at least ${data.amount_floor} from "${data.payee_token}" did not arrive by ${data.expiration_deadline} (+${data.grace_period_hours}h grace). Safe-to-spend has been shielded by ${data.amount_floor}.`,
            payload: {
                switch_id: data.switch_id,
                account_id: data.account_id,
                amount_floor: data.amount_floor,
                expected_direction: data.expected_direction,
                form_ref: "Dead Man's Switch Fault Response",
            },
            now,
        });
        recommendationIds.push(rec.rec_id);
    }

    return { faulted, shieldedAmount, recommendationIds };
}
