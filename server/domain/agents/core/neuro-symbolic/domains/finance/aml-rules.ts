/**
 * Anti-Money Laundering (AML) Ruleset
 * 
 * Financial compliance rules for neuro-symbolic verification.
 * Detects suspicious transactions and high-risk customers.
 */

import { DomainRuleset, LogicRule, PredicateSchema, NLTemplate } from '../../types.js';

/**
 * AML Predicate Schema
 */
export const amlSchema: PredicateSchema[] = [
  {
    name: 'transaction',
    arguments: [
      { name: 'id', type: 'string' },
      { name: 'amount', type: 'number' },
      { name: 'sender', type: 'string' },
      { name: 'receiver', type: 'string' },
      { name: 'timestamp', type: 'datetime' }
    ],
    description: 'A financial transaction between parties',
    example: 'transaction(tx123, 50000.00, customer_A, customer_B, 2024-01-15T10:30:00Z)'
  },
  {
    name: 'customer',
    arguments: [
      { name: 'id', type: 'string' },
      { name: 'risk_score', type: 'number' },
      { name: 'country', type: 'string' },
      { name: 'account_type', type: 'string' }
    ],
    description: 'A bank customer with risk profile',
    example: 'customer(customer_A, 75, "CN", "business")'
  },
  {
    name: 'high_risk_country',
    arguments: [{ name: 'country_code', type: 'string' }],
    description: 'Countries flagged for high AML risk',
    example: 'high_risk_country("CN")'
  },
  {
    name: 'suspicious',
    arguments: [
      { name: 'entity_id', type: 'string' },
      { name: 'reason', type: 'string' }
    ],
    description: 'Entity flagged as suspicious with reason',
    example: 'suspicious(tx123, "Large amount from high-risk country")'
  },
  {
    name: 'violation',
    arguments: [
      { name: 'rule_id', type: 'string' },
      { name: 'description', type: 'string' }
    ],
    description: 'AML rule violation',
    example: 'violation("AML-001", "Transaction exceeds threshold")'
  }
];

/**
 * AML Logic Rules
 */
export const amlRules: LogicRule[] = [
  {
    id: 'aml-001',
    name: 'Large Cash Transaction',
    head: {
      predicate: 'suspicious',
      arguments: [
        { type: 'variable', name: 'T' },
        { type: 'constant', value: 'Large transaction exceeds $10,000' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'transaction',
        arguments: [
          { type: 'variable', name: 'T' },
          { type: 'variable', name: 'Amount' },
          { type: 'variable', name: 'From' },
          { type: 'variable', name: 'To' },
          { type: 'variable', name: 'Time' }
        ],
        negated: false
      }
    ],
    defeasible: false,
    priority: 100,
    source: 'domain',
    explanationTemplate: 'Transaction {T} is suspicious because amount {Amount} exceeds $10,000 threshold'
  },
  {
    id: 'aml-002',
    name: 'High Risk Country',
    head: {
      predicate: 'suspicious',
      arguments: [
        { type: 'variable', name: 'T' },
        { type: 'constant', value: 'Transaction involves high-risk country' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'transaction',
        arguments: [
          { type: 'variable', name: 'T' },
          { type: 'variable', name: 'Amount' },
          { type: 'variable', name: 'From' },
          { type: 'variable', name: 'To' },
          { type: 'variable', name: 'Time' }
        ],
        negated: false
      },
      {
        predicate: 'customer',
        arguments: [
          { type: 'variable', name: 'From' },
          { type: 'variable', name: 'Risk' },
          { type: 'variable', name: 'Country' },
          { type: 'variable', name: 'Type' }
        ],
        negated: false
      },
      {
        predicate: 'high_risk_country',
        arguments: [{ type: 'variable', name: 'Country' }],
        negated: false
      }
    ],
    defeasible: false,
    priority: 90,
    source: 'domain',
    explanationTemplate: 'Transaction {T} is suspicious because sender {From} is from high-risk country {Country}'
  },
  {
    id: 'aml-003',
    name: 'Structuring Detection',
    head: {
      predicate: 'suspicious',
      arguments: [
        { type: 'variable', name: 'C' },
        { type: 'constant', value: 'Multiple transactions just below threshold' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'customer',
        arguments: [
          { type: 'variable', name: 'C' },
          { type: 'variable', name: 'Risk' },
          { type: 'variable', name: 'Country' },
          { type: 'variable', name: 'Type' }
        ],
        negated: false
      }
    ],
    defeasible: true,
    priority: 80,
    source: 'domain',
    explanationTemplate: 'Customer {C} may be structuring transactions to avoid reporting'
  },
  {
    id: 'aml-004',
    name: 'High Risk Customer Score',
    head: {
      predicate: 'suspicious',
      arguments: [
        { type: 'variable', name: 'T' },
        { type: 'constant', value: 'Customer has high risk score' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'transaction',
        arguments: [
          { type: 'variable', name: 'T' },
          { type: 'variable', name: 'Amount' },
          { type: 'variable', name: 'From' },
          { type: 'variable', name: 'To' },
          { type: 'variable', name: 'Time' }
        ],
        negated: false
      },
      {
        predicate: 'customer',
        arguments: [
          { type: 'variable', name: 'From' },
          { type: 'variable', name: 'Risk' },
          { type: 'variable', name: 'Country' },
          { type: 'variable', name: 'Type' }
        ],
        negated: false
      }
    ],
    defeasible: false,
    priority: 85,
    source: 'domain',
    explanationTemplate: 'Transaction {T} flagged because customer {From} has risk score {Risk}'
  },
  {
    id: 'aml-violation-001',
    name: 'Reportable Transaction',
    head: {
      predicate: 'violation',
      arguments: [
        { type: 'constant', value: 'AML-REPORT-001' },
        { type: 'constant', value: 'Transaction requires SAR filing' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'suspicious',
        arguments: [
          { type: 'variable', name: 'T' },
          { type: 'variable', name: 'Reason' }
        ],
        negated: false
      }
    ],
    defeasible: false,
    priority: 100,
    source: 'domain',
    explanationTemplate: 'Violation: Suspicious transaction {T} must be reported via SAR'
  }
];

/**
 * NL Templates for AML queries
 */
export const amlTemplates: NLTemplate[] = [
  {
    id: 'aml-query-1',
    pattern: 'Is transaction (\w+) suspicious',
    logicTemplate: 'suspicious($1, ?Reason)?',
    variables: ['transaction_id'],
    confidenceBoost: 0.9
  },
  {
    id: 'aml-query-2',
    pattern: 'Check customer (\w+) for violations',
    logicTemplate: 'violation(?Rule, ?Desc), customer($1, ?Risk, ?Country, ?Type)?',
    variables: ['customer_id'],
    confidenceBoost: 0.85
  },
  {
    id: 'aml-query-3',
    pattern: 'What are the risk factors for (\w+)',
    logicTemplate: 'suspicious($1, ?Reason)?',
    variables: ['entity_id'],
    confidenceBoost: 0.8
  },
  {
    id: 'aml-query-4',
    pattern: 'Should we report (\w+)',
    logicTemplate: 'violation(?Rule, ?Desc), suspicious($1, ?Reason)?',
    variables: ['transaction_id'],
    confidenceBoost: 0.9
  }
];

/**
 * AML Domain Ruleset
 */
export const amlRuleset: DomainRuleset = {
  domain: 'finance',
  displayName: 'Anti-Money Laundering (AML)',
  description: 'Financial compliance rules for detecting suspicious transactions and high-risk customers',
  rules: amlRules,
  schema: amlSchema,
  templates: amlTemplates,
  isDefault: false,
  version: '1.0.0'
};

/**
 * Sample high-risk countries
 */
export const highRiskCountries = [
  'AF',  // Afghanistan
  'BY',  // Belarus
  'MM',  // Myanmar
  'CF',  // Central African Republic
  'CN',  // China (high risk for certain transactions)
  'CU',  // Cuba
  'IR',  // Iran
  'KP',  // North Korea
  'RU',  // Russia
  'SY',  // Syria
  'VE',  // Venezuela
  'YE'   // Yemen
];

/**
 * Export Datalog facts for high-risk countries
 */
export function getHighRiskCountryFacts(): string {
  return highRiskCountries.map(cc => `high_risk_country("${cc}").`).join('\n');
}
