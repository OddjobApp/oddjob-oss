import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { FileParser } from "../infrastructure/file-parser.service.js";

/**
 * The parser used to collect only elements whose key contained "Task", which
 * yields an unordered bag of names: no order, no branching, no data. Anything
 * synthesising an application from that would have to invent the process.
 */

const parse = (xml: string) => {
    const tree = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
    const process = tree["bpmn:definitions"]?.["bpmn:process"] ?? tree["definitions"]?.["process"];
    return FileParser.toProcessGraph(process);
};

const INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="Process_Invoice" name="Invoice Approval">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Fin" name="Finance">
        <bpmn:flowNodeRef>Task_Review</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_1" name="Invoice received" />
    <bpmn:userTask id="Task_Review" name="Review invoice" />
    <bpmn:exclusiveGateway id="Gate_1" name="Over threshold?" default="Flow_Auto" />
    <bpmn:serviceTask id="Task_Pay" name="Pay invoice" />
    <bpmn:endEvent id="End_1" name="Done" />
    <bpmn:dataObject id="Data_Invoice" name="Invoice" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_Review" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Review" targetRef="Gate_1" />
    <bpmn:sequenceFlow id="Flow_Manual" sourceRef="Gate_1" targetRef="Task_Pay" name="over">
      <bpmn:conditionExpression>amount &gt; 1000</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_Auto" sourceRef="Gate_1" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;

describe("toProcessGraph", () => {
    it("extracts the ordering that makes a process a process", () => {
        const g = parse(INVOICE);

        expect(g.flows).toHaveLength(4);
        expect(g.flows.find((f) => f.id === "Flow_1")).toMatchObject({ from: "Start_1", to: "Task_Review" });
    });

    it("captures branching, which is where the business rules live", () => {
        const g = parse(INVOICE);

        expect(g.gateways).toEqual([
            { id: "Gate_1", name: "Over threshold?", kind: "exclusiveGateway", default: "Flow_Auto" },
        ]);
        // The condition becomes a CEL condition on the generated step; losing it
        // makes a conditional path look unconditional.
        expect(g.flows.find((f) => f.id === "Flow_Manual")?.condition).toBe("amount > 1000");
        expect(g.flows.find((f) => f.id === "Flow_Auto")?.condition).toBeNull();
    });

    it("keeps tasks with the lane that owns them", () => {
        const g = parse(INVOICE);

        expect(g.tasks).toEqual(expect.arrayContaining([
            { id: "Task_Review", name: "Review invoice", kind: "userTask", lane: "Finance" },
            { id: "Task_Pay", name: "Pay invoice", kind: "serviceTask", lane: null },
        ]));
    });

    it("records data objects and events rather than only tasks", () => {
        const g = parse(INVOICE);

        expect(g.dataObjects).toEqual([{ id: "Data_Invoice", name: "Invoice" }]);
        expect(g.events.map((e) => e.kind).sort()).toEqual(["endEvent", "startEvent"]);
    });

    it("identifies where the process starts", () => {
        const g = parse(INVOICE);

        expect(g.entryPoints).toEqual(["Start_1"]);
    });

    it("parses a single-task process the same way as a multi-task one", () => {
        // fast-xml-parser collapses a one-element list into a bare object; a
        // process must not parse differently because it is small.
        const g = parse(`<definitions><process id="P" name="Tiny">
            <userTask id="T1" name="Only task" />
            <sequenceFlow id="F1" sourceRef="S" targetRef="T1" />
        </process></definitions>`);

        expect(g.tasks).toHaveLength(1);
        expect(g.flows).toHaveLength(1);
    });

    it("works without a namespace prefix", () => {
        const g = parse(`<definitions><process id="P" name="Plain">
            <serviceTask id="T1" name="Do it" />
        </process></definitions>`);

        expect(g.processName).toBe("Plain");
        expect(g.tasks[0].kind).toBe("serviceTask");
    });

    it("reports a flow pointing at a node that does not exist, rather than dropping it", () => {
        const g = parse(`<definitions><process id="P">
            <userTask id="T1" name="A" />
            <sequenceFlow id="F_bad" sourceRef="T1" targetRef="T_missing" />
        </process></definitions>`);

        // Silently dropping this would let a synthesiser build a plausible
        // process the author never drew.
        expect(g.danglingFlows).toEqual([{ id: "F_bad", from: "T1", to: "T_missing" }]);
    });

    it("summarises for an agent without making it re-derive the graph", () => {
        const summary = FileParser.describeProcessGraph(parse(INVOICE));

        expect(summary).toContain("Invoice Approval");
        expect(summary).toContain("Review invoice");
        expect(summary).toContain("amount > 1000");
        expect(summary).toContain("lane: Finance");
    });
});
