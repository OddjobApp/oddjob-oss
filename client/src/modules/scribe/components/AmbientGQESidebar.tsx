import React, { useState } from 'react';
import { Sparkles, HelpCircle, Check, Plus, Lightbulb } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScribeArchetypeMode } from '@shared/schema/scribe';

export interface AmbientQuestion {
  questionId: string;
  stationKey: string;
  question: string;
  quickOptions?: string[];
  isResolved: boolean;
  priority: number;
  scaffoldingTemplate?: string;
}

interface AmbientGQESidebarProps {
  archetypeMode: ScribeArchetypeMode;
  stationKey: string;
  stationTitle: string;
  currentContent: string;
  onInsertScaffolding: (text: string) => void;
  className?: string;
}

const STATION_QUESTION_BANKS: Record<string, Record<string, AmbientQuestion[]>> = {
  sow_statement_of_work: {
    project_overview_objectives: [
      {
        questionId: 'sow_obj_1',
        stationKey: 'project_overview_objectives',
        question: 'What is the primary business outcome this project achieves?',
        quickOptions: ['Cloud Modernization', 'Operational Efficiency', 'Cost Reduction', 'Security Hardening', 'Regulatory Compliance'],
        isResolved: false,
        priority: 9,
        scaffoldingTemplate: 'The primary objective of this engagement is to deliver {option} across the enterprise footprint.',
      },
    ],
    scope_in_out: [
      {
        questionId: 'sow_scope_out',
        stationKey: 'scope_in_out',
        question: "What activities are explicitly out of scope?",
        quickOptions: ['End-User Training', 'Legacy Data Migration', 'Hardware Procurement', 'Third-Party Licences', 'Custom Mobile App'],
        isResolved: false,
        priority: 10,
        scaffoldingTemplate: 'The following activities are explicitly excluded from this engagement: {option}.',
      },
      {
        questionId: 'sow_scope_in',
        stationKey: 'scope_in_out',
        question: 'What are the core technical systems in scope?',
        quickOptions: ['Production Cloud Infrastructure', 'API Microservices', 'Database Migration', 'CI/CD Pipeline'],
        isResolved: false,
        priority: 9,
        scaffoldingTemplate: 'The direct scope of work includes architecture and deployment of {option}.',
      },
    ],
    deliverables_acceptance: [
      {
        questionId: 'sow_deliv_criteria',
        stationKey: 'deliverables_acceptance',
        question: 'What constitutes formal acceptance for key deliverables?',
        quickOptions: ['5 Business Days Review', 'Automated QA Test Suite Passing', 'Executive Sign-Off', 'Zero Critical Defects'],
        isResolved: false,
        priority: 9,
        scaffoldingTemplate: 'Formal acceptance will occur upon {option} following delivery.',
      },
    ],
    milestones_timeline: [
      {
        questionId: 'sow_milestone_count',
        stationKey: 'milestones_timeline',
        question: 'How many major delivery phases or milestones?',
        quickOptions: ['2 Phases (Discovery + Execution)', '3 Milestones (Plan, Build, Cutover)', '4 Sprints', 'Agile Bi-Weekly'],
        isResolved: false,
        priority: 9,
        scaffoldingTemplate: 'Project delivery is structured into {option}.',
      },
    ],
    commercials_payment_milestones: [
      {
        questionId: 'sow_pricing_model',
        stationKey: 'commercials_payment_milestones',
        question: 'What is the commercial billing structure?',
        quickOptions: ['Fixed Fee (Milestone-based)', 'Time & Materials (T&M)', 'Monthly Retainer', 'Blended Rate'],
        isResolved: false,
        priority: 10,
        scaffoldingTemplate: 'Services will be invoiced on a {option} basis with net-30 payment terms.',
      },
    ],
    assumptions_risk_mitigation: [
      {
        questionId: 'sow_assumptions',
        stationKey: 'assumptions_risk_mitigation',
        question: 'What key dependencies or client assumptions exist?',
        quickOptions: ['Timely Cloud Access', 'Existing Documentation Accuracy', 'SME Availability', 'Staging Environment Ready'],
        isResolved: false,
        priority: 8,
        scaffoldingTemplate: 'This engagement relies on the following key assumption: {option}.',
      },
    ],
  },
  enterprise_sop: {
    purpose_scope_ownership: [
      {
        questionId: 'sop_owner',
        stationKey: 'purpose_scope_ownership',
        question: 'Who is the primary operational owner for this SOP?',
        quickOptions: ['DevOps / SRE Team', 'Security Operations (SecOps)', 'Database Administration', 'Platform Engineering'],
        isResolved: false,
        priority: 10,
        scaffoldingTemplate: 'This standard operating procedure is owned and maintained by the {option}.',
      },
    ],
    prerequisites_access: [
      {
        questionId: 'sop_access_req',
        stationKey: 'prerequisites_access',
        question: 'What privileged access or tools are required before execution?',
        quickOptions: ['VPN & Bastion Host', 'Production Read/Write IAM Role', 'MFA Token & Approval Ticket', 'Kubernetes Admin Context'],
        isResolved: false,
        priority: 9,
        scaffoldingTemplate: 'Operators must possess active {option} prior to starting this procedure.',
      },
    ],
  },
  business_doc_best_practices: {
    executive_summary_context: [
      {
        questionId: 'biz_problem',
        stationKey: 'executive_summary_context',
        question: 'What strategic problem or market opportunity triggered this case?',
        quickOptions: ['Legacy System Inefficiencies', 'Competitive Disruption', 'Revenue Growth Opportunity', 'Regulatory Compliance Mandate'],
        isResolved: false,
        priority: 10,
        scaffoldingTemplate: 'This initiative is initiated to address {option}.',
      },
    ],
    financial_cost_benefit_roi: [
      {
        questionId: 'biz_roi_timeline',
        stationKey: 'financial_cost_benefit_roi',
        question: 'What is the target payback horizon or hurdle rate?',
        quickOptions: ['12 Months Payback', '18 Months Payback', '24 Months Payback', '> 35% IRR'],
        isResolved: false,
        priority: 9,
        scaffoldingTemplate: 'The projected economic investment yields an estimated {option}.',
      },
    ],
  },
};

export const AmbientGQESidebar: React.FC<AmbientGQESidebarProps> = ({
  archetypeMode,
  stationKey,
  stationTitle,
  currentContent,
  onInsertScaffolding,
  className = '',
}) => {
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [customInputId, setCustomInputId] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');

  const questions = (STATION_QUESTION_BANKS[archetypeMode]?.[stationKey] || [
    {
      questionId: `default_${stationKey}`,
      stationKey,
      question: `What key requirements or constraints apply to "${stationTitle}"?`,
      quickOptions: ['Industry Standard Terms', 'Executive Level Context', 'Detailed Technical Steps'],
      isResolved: false,
      priority: 5,
      scaffoldingTemplate: `Regarding ${stationTitle}, the following criteria apply: {option}.`,
    },
  ]).filter((q) => !resolvedIds.has(q.questionId));

  const handleChipClick = (q: AmbientQuestion, option: string) => {
    const template = q.scaffoldingTemplate || '{option}';
    const textToInsert = template.replace('{option}', option);
    onInsertScaffolding(textToInsert);
    setResolvedIds((prev) => new Set([...prev, q.questionId]));
  };

  const handleCustomSubmit = (q: AmbientQuestion) => {
    if (!customText.trim()) return;
    const template = q.scaffoldingTemplate || '{option}';
    const textToInsert = template.replace('{option}', customText.trim());
    onInsertScaffolding(textToInsert);
    setResolvedIds((prev) => new Set([...prev, q.questionId]));
    setCustomInputId(null);
    setCustomText('');
  };

  if (questions.length === 0) {
    return null;
  }

  return (
    <div
      className={`border-l border-border/60 bg-muted/20 p-3 space-y-3 font-sans text-xs ${className}`}
      data-testid="ambient-gqe-sidebar"
    >
      <div className="flex items-center gap-1.5 text-indigo-400 font-semibold text-[11px] uppercase tracking-wider">
        <Lightbulb className="w-3.5 h-3.5" />
        <span>Ambient GQE Co-Author</span>
      </div>

      <div className="space-y-3">
        {questions.map((q) => (
          <div
            key={q.questionId}
            className="rounded-lg border border-indigo-500/20 bg-card/90 p-3 shadow-xs space-y-2 transition-all hover:border-indigo-500/40"
          >
            <div className="flex items-start gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
              <p className="font-medium text-foreground text-[12px] leading-snug">{q.question}</p>
            </div>

            {q.quickOptions && q.quickOptions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {q.quickOptions.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handleChipClick(q, opt)}
                    className="inline-flex items-center rounded-md bg-indigo-950/40 px-2 py-1 text-[11px] font-medium text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600 hover:text-white transition-colors cursor-pointer text-left"
                  >
                    <Plus className="w-2.5 h-2.5 mr-1" />
                    <span>{opt}</span>
                  </button>
                ))}
              </div>
            )}

            {customInputId === q.questionId ? (
              <div className="flex items-center gap-1.5 pt-1">
                <input
                  type="text"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder="Type custom answer..."
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
                  onKeyDown={(e) => e.key === 'Enter' && handleCustomSubmit(q)}
                />
                <Button size="sm" onClick={() => handleCustomSubmit(q)} className="h-6 text-[10px] px-2">
                  Add
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCustomInputId(q.questionId)}
                className="text-[10px] text-muted-foreground hover:text-indigo-400 underline decoration-dotted"
              >
                + Custom answer...
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
