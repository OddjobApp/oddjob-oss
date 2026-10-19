/**
 * Legal Contract & Compliance Ruleset
 * 
 * Contract analysis, regulatory compliance, and legal reasoning.
 * Implements legal domain logic for contract review and compliance checking.
 */

import { DomainRuleset, LogicRule, PredicateSchema, NLTemplate } from '../../types.js';

/**
 * Legal Predicate Schema
 */
export const legalSchema: PredicateSchema[] = [
  {
    name: 'contract',
    arguments: [
      { name: 'id', type: 'string' },
      { name: 'type', type: 'string' },
      { name: 'parties', type: 'string[]' },
      { name: 'jurisdiction', type: 'string' },
      { name: 'effective_date', type: 'datetime' }
    ],
    description: 'Contract metadata',
    example: 'contract(C001, "service_agreement", ["Acme Corp", "TechCo LLC"], "Delaware", "2024-01-15T00:00:00Z")'
  },
  {
    name: 'clause',
    arguments: [
      { name: 'contract_id', type: 'string' },
      { name: 'clause_type', type: 'string' },
      { name: 'text', type: 'string' },
      { name: 'risk_level', type: 'string' }
    ],
    description: 'Individual contract clauses',
    example: 'clause(C001, "termination", "Either party may terminate...", "medium")'
  },
  {
    name: 'obligation',
    arguments: [
      { name: 'contract_id', type: 'string' },
      { name: 'party', type: 'string' },
      { name: 'obligation_type', type: 'string' },
      { name: 'due_date', type: 'datetime' },
      { name: 'status', type: 'string' }
    ],
    description: 'Contractual obligations',
    example: 'obligation(C001, "Acme Corp", "payment", "2024-02-15T00:00:00Z", "pending")'
  },
  {
    name: 'regulatory_requirement',
    arguments: [
      { name: 'regulation', type: 'string' },
      { name: 'jurisdiction', type: 'string' },
      { name: 'requirement_type', type: 'string' },
      { name: 'description', type: 'string' }
    ],
    description: 'Applicable regulations',
    example: 'regulatory_requirement("GDPR", "EU", "data_processing", "Lawful basis required")'
  },
  {
    name: 'compliance_check',
    arguments: [
      { name: 'contract_id', type: 'string' },
      { name: 'regulation', type: 'string' },
      { name: 'compliant', type: 'boolean' },
      { name: 'violation_details', type: 'string' }
    ],
    description: 'Compliance verification results',
    example: 'compliance_check(C001, "GDPR", false, "Missing data processing clause")'
  },
  {
    name: 'risk_factor',
    arguments: [
      { name: 'contract_id', type: 'string' },
      { name: 'risk_type', type: 'string' },
      { name: 'severity', type: 'string' },
      { name: 'description', type: 'string' }
    ],
    description: 'Identified contract risks',
    example: 'risk_factor(C001, "liability", "high", "Unlimited liability clause")'
  },
  {
    name: 'party',
    arguments: [
      { name: 'name', type: 'string' },
      { name: 'type', type: 'string' },
      { name: 'credit_rating', type: 'string' },
      { name: 'incorporation_country', type: 'string' }
    ],
    description: 'Contract parties information',
    example: 'party("Acme Corp", "corporation", "A+", "US")'
  },
  {
    name: 'dispute_resolution',
    arguments: [
      { name: 'contract_id', type: 'string' },
      { name: 'mechanism', type: 'string' },
      { name: 'venue', type: 'string' },
      { name: 'governing_law', type: 'string' }
    ],
    description: 'Dispute resolution terms',
    example: 'dispute_resolution(C001, "arbitration", "New York", "New York State Law")'
  },
  {
    name: 'term',
    arguments: [
      { name: 'contract_id', type: 'string' },
      { name: 'term_type', type: 'string' },
      { name: 'value', type: 'string' },
      { name: 'favorable_to', type: 'string' }
    ],
    description: 'Specific contract terms',
    example: 'term(C001, "payment_terms", "Net 30", "seller")'
  },
  {
    name: 'violation',
    arguments: [
      { name: 'rule_id', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'severity', type: 'string' },
      { name: 'remediation', type: 'string' }
    ],
    description: 'Contract compliance violations',
    example: 'violation("REG-001", "Missing GDPR compliance clause", "critical", "Add data protection addendum")'
  },
  {
    name: 'approval',
    arguments: [
      { name: 'contract_id', type: 'string' },
      { name: 'approver_role', type: 'string' },
      { name: 'status', type: 'string' },
      { name: 'required', type: 'boolean' }
    ],
    description: 'Approval workflow requirements',
    example: 'approval(C001, "legal_counsel", "pending", true)'
  }
];

/**
 * Legal Logic Rules
 */
export const legalRules: LogicRule[] = [
  // GDPR Compliance
  {
    id: 'gdpr-001',
    name: 'GDPR Data Processing Clause Required',
    head: {
      predicate: 'violation',
      arguments: [
        { type: 'constant', value: 'GDPR-001' },
        { type: 'constant', value: 'Missing GDPR data processing clause' },
        { type: 'constant', value: 'critical' },
        { type: 'constant', value: 'Add Article 28 data processing clause' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'contract',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' },
          { type: 'constant', value: 'EU' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      },
      {
        predicate: 'clause',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'constant', value: 'data_processing' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: true  // NOT EXISTS
      }
    ],
    defeasible: false,
    priority: 100,
    source: 'domain',
    explanationTemplate: 'Contract {C} under EU jurisdiction requires GDPR Article 28 data processing clause'
  },
  {
    id: 'gdpr-002',
    name: 'GDPR Lawful Basis Required',
    head: {
      predicate: 'violation',
      arguments: [
        { type: 'constant', value: 'GDPR-002' },
        { type: 'constant', value: 'Missing lawful basis for data processing' },
        { type: 'constant', value: 'critical' },
        { type: 'constant', value: 'Specify consent, contract, or legitimate interest' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'compliance_check',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'constant', value: 'GDPR' },
          { type: 'constant', value: false },
          { type: 'variable', name: '_' }
        ],
        negated: false
      }
    ],
    defeasible: false,
    priority: 100,
    source: 'domain',
    explanationTemplate: 'Contract {C} must specify lawful basis for GDPR data processing'
  },
  // CCPA Compliance
  {
    id: 'ccpa-001',
    name: 'CCPA Consumer Rights Clause',
    head: {
      predicate: 'violation',
      arguments: [
        { type: 'constant', value: 'CCPA-001' },
        { type: 'constant', value: 'Missing CCPA consumer rights disclosure' },
        { type: 'constant', value: 'high' },
        { type: 'constant', value: 'Add CCPA Section 1798.100-1798.199 compliance clause' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'contract',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' },
          { type: 'constant', value: 'California' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      },
      {
        predicate: 'clause',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'constant', value: 'ccpa_rights' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: true
      }
    ],
    defeasible: false,
    priority: 95,
    source: 'domain',
    explanationTemplate: 'California contracts require CCPA consumer rights disclosure'
  },
  // SOX Compliance
  {
    id: 'sox-001',
    name: 'SOX Financial Record Keeping',
    head: {
      predicate: 'violation',
      arguments: [
        { type: 'constant', value: 'SOX-001' },
        { type: 'constant', value: 'Inadequate financial record keeping provisions' },
        { type: 'constant', value: 'critical' },
        { type: 'constant', value: 'Add SOX Section 802 record retention requirements' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'contract',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'constant', value: 'financial_service' },
          { type: 'variable', name: '_' },
          { type: 'constant', value: 'US' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      },
      {
        predicate: 'clause',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'constant', value: 'record_retention' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: true
      }
    ],
    defeasible: false,
    priority: 100,
    source: 'domain',
    explanationTemplate: 'Financial services contract {C} requires SOX record retention provisions'
  },
  // Risk Assessment
  {
    id: 'risk-001',
    name: 'Unlimited Liability Risk',
    head: {
      predicate: 'risk_factor',
      arguments: [
        { type: 'variable', name: 'C' },
        { type: 'constant', value: 'liability' },
        { type: 'constant', value: 'high' },
        { type: 'constant', value: 'Unlimited liability clause detected' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'clause',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'constant', value: 'liability' },
          { type: 'variable', name: 'T' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      }
    ],
    defeasible: false,
    priority: 90,
    source: 'domain',
    explanationTemplate: 'Contract {C} has unlimited liability clause - cap recommended'
  },
  {
    id: 'risk-002',
    name: 'Auto-Renewal Risk',
    head: {
      predicate: 'risk_factor',
      arguments: [
        { type: 'variable', name: 'C' },
        { type: 'constant', value: 'auto_renewal' },
        { type: 'constant', value: 'medium' },
        { type: 'constant', value: 'Auto-renewal without termination notice' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'clause',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'constant', value: 'auto_renewal' },
          { type: 'variable', name: 'T' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      }
    ],
    defeasible: true,
    priority: 70,
    source: 'domain',
    explanationTemplate: 'Contract {C} has auto-renewal - ensure termination notice period is adequate'
  },
  // Payment Terms
  {
    id: 'payment-001',
    name: 'Extended Payment Terms Risk',
    head: {
      predicate: 'risk_factor',
      arguments: [
        { type: 'variable', name: 'C' },
        { type: 'constant', value: 'cash_flow' },
        { type: 'constant', value: 'medium' },
        { type: 'constant', value: 'Payment terms exceed 60 days' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'term',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'constant', value: 'payment_terms' },
          { type: 'variable', name: 'V' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      }
    ],
    defeasible: true,
    priority: 60,
    source: 'domain',
    explanationTemplate: 'Contract {C} payment terms may impact cash flow'
  },
  // Intellectual Property
  {
    id: 'ip-001',
    name: 'IP Ownership Ambiguity',
    head: {
      predicate: 'violation',
      arguments: [
        { type: 'constant', value: 'IP-001' },
        { type: 'constant', value: 'IP ownership clause ambiguous or missing' },
        { type: 'constant', value: 'high' },
        { type: 'constant', value: 'Clarify IP ownership and licensing terms' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'contract',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'constant', value: 'software_license' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      },
      {
        predicate: 'clause',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'constant', value: 'ip_ownership' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: true
      }
    ],
    defeasible: false,
    priority: 85,
    source: 'domain',
    explanationTemplate: 'Software contract {C} must specify IP ownership terms'
  },
  // Termination
  {
    id: 'term-001',
    name: 'Termination for Convenience Missing',
    head: {
      predicate: 'risk_factor',
      arguments: [
        { type: 'variable', name: 'C' },
        { type: 'constant', value: 'termination' },
        { type: 'constant', value: 'medium' },
        { type: 'constant', value: 'No termination for convenience clause' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'clause',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'constant', value: 'termination_convenience' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: true
      }
    ],
    defeasible: true,
    priority: 60,
    source: 'domain',
    explanationTemplate: 'Contract {C} lacks termination for convenience - limits flexibility'
  },
  // Approval Workflow
  {
    id: 'approval-001',
    name: 'High Value Contract Approval',
    head: {
      predicate: 'approval',
      arguments: [
        { type: 'variable', name: 'C' },
        { type: 'constant', value: 'cfo' },
        { type: 'constant', value: 'required' },
        { type: 'constant', value: true }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'term',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'constant', value: 'contract_value' },
          { type: 'variable', name: 'V' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      }
    ],
    defeasible: false,
    priority: 80,
    source: 'domain',
    explanationTemplate: 'High value contract {C} requires CFO approval'
  },
  // Jurisdiction
  {
    id: 'juris-001',
    name: 'Jurisdiction Mismatch Risk',
    head: {
      predicate: 'risk_factor',
      arguments: [
        { type: 'variable', name: 'C' },
        { type: 'constant', value: 'jurisdiction' },
        { type: 'constant', value: 'medium' },
        { type: 'constant', value: 'Governing law and jurisdiction mismatch' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'contract',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: 'J1' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      },
      {
        predicate: 'dispute_resolution',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: 'J2' },
          { type: 'variable', name: 'G' }
        ],
        negated: false
      }
    ],
    defeasible: true,
    priority: 65,
    source: 'domain',
    explanationTemplate: 'Contract {C} jurisdiction ({J1}) may not align with governing law ({G})'
  }
];

/**
 * NL Templates for Legal Queries
 */
export const legalTemplates: NLTemplate[] = [
  {
    id: 'legal-001',
    pattern: 'Is contract (\w+) compliant with (GDPR|CCPA|SOX)',
    logicTemplate: 'compliance_check($1, "$2", C, D)?',
    variables: ['contract_id', 'regulation'],
    confidenceBoost: 0.9
  },
  {
    id: 'legal-002',
    pattern: 'What are the risks in contract (\w+)',
    logicTemplate: 'risk_factor($1, T, S, D)?',
    variables: ['contract_id'],
    confidenceBoost: 0.85
  },
  {
    id: 'legal-003',
    pattern: 'Does contract (\w+) have any violations',
    logicTemplate: 'violation(R, D, S, M), clause($1, _, _, _)?',
    variables: ['contract_id'],
    confidenceBoost: 0.9
  },
  {
    id: 'legal-004',
    pattern: 'What obligations does (\w+) have in contract (\w+)',
    logicTemplate: 'obligation($2, $1, T, D, S)?',
    variables: ['party', 'contract_id'],
    confidenceBoost: 0.85
  },
  {
    id: 'legal-005',
    pattern: 'Check IP ownership for contract (\w+)',
    logicTemplate: 'clause($1, "ip_ownership", T, R)?',
    variables: ['contract_id'],
    confidenceBoost: 0.9
  },
  {
    id: 'legal-006',
    pattern: 'What approvals are required for contract (\w+)',
    logicTemplate: 'approval($1, R, S, Req)?',
    variables: ['contract_id'],
    confidenceBoost: 0.9
  }
];

/**
 * Legal Domain Ruleset
 */
export const legalRuleset: DomainRuleset = {
  domain: 'legal',
  displayName: 'Legal & Contract Compliance',
  description: 'Contract analysis, regulatory compliance (GDPR, CCPA, SOX), risk assessment, and legal reasoning for enterprise contracts',
  rules: legalRules,
  schema: legalSchema,
  templates: legalTemplates,
  isDefault: false,
  version: '1.0.0'
};

/**
 * GDPR Required Clauses
 */
export const gdprRequiredClauses = [
  'data_processing_purpose',
  'data_subject_rights',
  'data_breach_notification',
  'subprocessor_authorization',
  'data_transfer_mechanisms',
  'data_retention_deletion',
  'audit_rights',
  'security_measures'
];

/**
 * High Risk Contract Terms
 */
export const highRiskTerms = [
  'unlimited_liability',
  'indemnification_without_cap',
  'no_termination_for_convenience',
  'auto_renewal_without_notice',
  'exclusive_dealing_requirement',
  'most_favored_customer',
  'change_of_control_termination',
  'assignment_restrictions'
];

/**
 * Export GDPR requirements as Datalog facts
 */
export function getGDPRClauseFacts(): string {
  return gdprRequiredClauses.map(
    clause => `required_clause("GDPR", "${clause}").`
  ).join('\n');
}

/**
 * Export high risk terms as Datalog facts
 */
export function getHighRiskTermFacts(): string {
  return highRiskTerms.map(
    term => `high_risk_term("${term}").`
  ).join('\n');
}
