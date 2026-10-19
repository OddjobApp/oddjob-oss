/**
 * Clinical Healthcare Ruleset
 * 
 * Medical diagnosis verification and clinical decision support.
 * Implements clinical guidelines and safety checks for healthcare AI.
 */

import { DomainRuleset, LogicRule, PredicateSchema, NLTemplate } from '../../types.js';

/**
 * Clinical Predicate Schema
 */
export const clinicalSchema: PredicateSchema[] = [
  {
    name: 'patient',
    arguments: [
      { name: 'id', type: 'string' },
      { name: 'age', type: 'number' },
      { name: 'gender', type: 'string' },
      { name: 'weight_kg', type: 'number' }
    ],
    description: 'Patient demographic information',
    example: 'patient(P123, 45, "male", 75.5)'
  },
  {
    name: 'symptom',
    arguments: [
      { name: 'patient_id', type: 'string' },
      { name: 'symptom_name', type: 'string' },
      { name: 'severity', type: 'number' },
      { name: 'duration_days', type: 'number' }
    ],
    description: 'Patient symptoms with severity and duration',
    example: 'symptom(P123, "chest_pain", 8, 2)'
  },
  {
    name: 'vital_sign',
    arguments: [
      { name: 'patient_id', type: 'string' },
      { name: 'type', type: 'string' },
      { name: 'value', type: 'number' },
      { name: 'unit', type: 'string' },
      { name: 'timestamp', type: 'datetime' }
    ],
    description: 'Vital signs measurements',
    example: 'vital_sign(P123, "blood_pressure_systolic", 140, "mmHg", "2024-01-15T10:30:00Z")'
  },
  {
    name: 'lab_result',
    arguments: [
      { name: 'patient_id', type: 'string' },
      { name: 'test_name', type: 'string' },
      { name: 'value', type: 'number' },
      { name: 'unit', type: 'string' },
      { name: 'reference_min', type: 'number' },
      { name: 'reference_max', type: 'number' }
    ],
    description: 'Laboratory test results',
    example: 'lab_result(P123, "glucose", 180, "mg/dL", 70, 100)'
  },
  {
    name: 'medication',
    arguments: [
      { name: 'patient_id', type: 'string' },
      { name: 'drug_name', type: 'string' },
      { name: 'dosage', type: 'number' },
      { name: 'unit', type: 'string' },
      { name: 'frequency', type: 'string' }
    ],
    description: 'Current medications',
    example: 'medication(P123, "metformin", 500, "mg", "twice_daily")'
  },
  {
    name: 'allergy',
    arguments: [
      { name: 'patient_id', type: 'string' },
      { name: 'allergen', type: 'string' },
      { name: 'severity', type: 'string' },
      { name: 'reaction_type', type: 'string' }
    ],
    description: 'Patient allergies',
    example: 'allergy(P123, "penicillin", "severe", "anaphylaxis")'
  },
  {
    name: 'diagnosis',
    arguments: [
      { name: 'patient_id', type: 'string' },
      { name: 'condition', type: 'string' },
      { name: 'icd10_code', type: 'string' },
      { name: 'confidence', type: 'number' },
      { name: 'severity', type: 'string' }
    ],
    description: 'Clinical diagnoses',
    example: 'diagnosis(P123, "Type_2_Diabetes", "E11.9", 0.95, "controlled")'
  },
  {
    name: 'contraindication',
    arguments: [
      { name: 'drug', type: 'string' },
      { name: 'condition', type: 'string' },
      { name: 'severity', type: 'string' },
      { name: 'mechanism', type: 'string' }
    ],
    description: 'Drug contraindications',
    example: 'contraindication("warfarin", "bleeding_disorder", "absolute", "increased_bleeding_risk")'
  },
  {
    name: 'drug_interaction',
    arguments: [
      { name: 'drug1', type: 'string' },
      { name: 'drug2', type: 'string' },
      { name: 'severity', type: 'string' },
      { name: 'mechanism', type: 'string' }
    ],
    description: 'Drug-drug interactions',
    example: 'drug_interaction("warfarin", "aspirin", "major", "increased_anticoagulation")'
  },
  {
    name: 'alert',
    arguments: [
      { name: 'patient_id', type: 'string' },
      { name: 'alert_type', type: 'string' },
      { name: 'severity', type: 'string' },
      { name: 'message', type: 'string' }
    ],
    description: 'Clinical alerts',
    example: 'alert(P123, "critical_lab_value", "high", "Glucose > 400 mg/dL")'
  },
  {
    name: 'violation',
    arguments: [
      { name: 'rule_id', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'severity', type: 'string' }
    ],
    description: 'Clinical safety violations',
    example: 'violation("SAF-001", "Contraindicated medication prescribed", "critical")'
  }
];

/**
 * Clinical Logic Rules
 */
export const clinicalRules: LogicRule[] = [
  // Critical vital signs
  {
    id: 'vit-001',
    name: 'Critical Hypertension',
    head: {
      predicate: 'alert',
      arguments: [
        { type: 'variable', name: 'P' },
        { type: 'constant', value: 'critical_hypertension' },
        { type: 'constant', value: 'high' },
        { type: 'constant', value: 'Blood pressure > 180/120 mmHg' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'vital_sign',
        arguments: [
          { type: 'variable', name: 'P' },
          { type: 'constant', value: 'blood_pressure_systolic' },
          { type: 'variable', name: 'SBP' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      }
    ],
    defeasible: false,
    priority: 100,
    source: 'domain',
    explanationTemplate: 'Patient {P} has critical hypertension (SBP > 180) requiring immediate attention'
  },
  {
    id: 'vit-002',
    name: 'Severe Hypotension',
    head: {
      predicate: 'alert',
      arguments: [
        { type: 'variable', name: 'P' },
        { type: 'constant', value: 'severe_hypotension' },
        { type: 'constant', value: 'high' },
        { type: 'constant', value: 'Blood pressure < 90/60 mmHg' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'vital_sign',
        arguments: [
          { type: 'variable', name: 'P' },
          { type: 'constant', value: 'blood_pressure_systolic' },
          { type: 'variable', name: 'SBP' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      }
    ],
    defeasible: false,
    priority: 100,
    source: 'domain',
    explanationTemplate: 'Patient {P} has severe hypotension (SBP < 90) requiring immediate attention'
  },
  {
    id: 'vit-003',
    name: 'Critical Heart Rate',
    head: {
      predicate: 'alert',
      arguments: [
        { type: 'variable', name: 'P' },
        { type: 'constant', value: 'critical_heart_rate' },
        { type: 'constant', value: 'high' },
        { type: 'constant', value: 'Heart rate outside normal range' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'vital_sign',
        arguments: [
          { type: 'variable', name: 'P' },
          { type: 'constant', value: 'heart_rate' },
          { type: 'variable', name: 'HR' },
          { type: 'constant', value: 'bpm' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      }
    ],
    defeasible: false,
    priority: 95,
    source: 'domain',
    explanationTemplate: 'Patient {P} has critical heart rate (HR: {HR}) outside safe range'
  },
  // Lab value alerts
  {
    id: 'lab-001',
    name: 'Critical Glucose',
    head: {
      predicate: 'alert',
      arguments: [
        { type: 'variable', name: 'P' },
        { type: 'constant', value: 'critical_glucose' },
        { type: 'constant', value: 'critical' },
        { type: 'constant', value: 'Glucose > 400 mg/dL' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'lab_result',
        arguments: [
          { type: 'variable', name: 'P' },
          { type: 'constant', value: 'glucose' },
          { type: 'variable', name: 'G' },
          { type: 'constant', value: 'mg/dL' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      }
    ],
    defeasible: false,
    priority: 100,
    source: 'domain',
    explanationTemplate: 'Patient {P} has critical glucose level: {G} mg/dL (normal: 70-100)'
  },
  {
    id: 'lab-002',
    name: 'Severe Anemia',
    head: {
      predicate: 'alert',
      arguments: [
        { type: 'variable', name: 'P' },
        { type: 'constant', value: 'severe_anemia' },
        { type: 'constant', value: 'high' },
        { type: 'constant', value: 'Hemoglobin < 7 g/dL' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'lab_result',
        arguments: [
          { type: 'variable', name: 'P' },
          { type: 'constant', value: 'hemoglobin' },
          { type: 'variable', name: 'HGB' },
          { type: 'constant', value: 'g/dL' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      }
    ],
    defeasible: false,
    priority: 90,
    source: 'domain',
    explanationTemplate: 'Patient {P} has severe anemia (HGB: {HGB} g/dL)'
  },
  // Drug interactions
  {
    id: 'drug-001',
    name: 'Major Drug Interaction',
    head: {
      predicate: 'alert',
      arguments: [
        { type: 'variable', name: 'P' },
        { type: 'constant', value: 'drug_interaction_major' },
        { type: 'constant', value: 'high' },
        { type: 'constant', value: 'Major drug interaction detected' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'medication',
        arguments: [
          { type: 'variable', name: 'P' },
          { type: 'variable', name: 'D1' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      },
      {
        predicate: 'medication',
        arguments: [
          { type: 'variable', name: 'P' },
          { type: 'variable', name: 'D2' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      },
      {
        predicate: 'drug_interaction',
        arguments: [
          { type: 'variable', name: 'D1' },
          { type: 'variable', name: 'D2' },
          { type: 'constant', value: 'major' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      }
    ],
    defeasible: false,
    priority: 95,
    source: 'domain',
    explanationTemplate: 'Major drug interaction between {D1} and {D2} for patient {P}'
  },
  // Contraindications
  {
    id: 'contra-001',
    name: 'Absolute Contraindication',
    head: {
      predicate: 'violation',
      arguments: [
        { type: 'constant', value: 'SAF-001' },
        { type: 'constant', value: 'Absolute contraindication violated' },
        { type: 'constant', value: 'critical' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'medication',
        arguments: [
          { type: 'variable', name: 'P' },
          { type: 'variable', name: 'D' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      },
      {
        predicate: 'diagnosis',
        arguments: [
          { type: 'variable', name: 'P' },
          { type: 'variable', name: 'C' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      },
      {
        predicate: 'contraindication',
        arguments: [
          { type: 'variable', name: 'D' },
          { type: 'variable', name: 'C' },
          { type: 'constant', value: 'absolute' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      }
    ],
    defeasible: false,
    priority: 100,
    source: 'domain',
    explanationTemplate: 'CRITICAL: Drug {D} is absolutely contraindicated with condition {C}'
  },
  // Allergy checks
  {
    id: 'allergy-001',
    name: 'Known Allergy Alert',
    head: {
      predicate: 'alert',
      arguments: [
        { type: 'variable', name: 'P' },
        { type: 'constant', value: 'allergy_alert' },
        { type: 'constant', value: 'critical' },
        { type: 'constant', value: 'Patient has known allergy to prescribed medication' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'medication',
        arguments: [
          { type: 'variable', name: 'P' },
          { type: 'variable', name: 'D' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      },
      {
        predicate: 'allergy',
        arguments: [
          { type: 'variable', name: 'P' },
          { type: 'variable', name: 'A' },
          { type: 'variable', name: 'S' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      }
    ],
    defeasible: false,
    priority: 100,
    source: 'domain',
    explanationTemplate: 'CRITICAL: Patient {P} has {S} allergy to {A}, contraindicated with {D}'
  },
  // Diagnosis verification
  {
    id: 'diag-001',
    name: 'Diabetes with High Glucose',
    head: {
      predicate: 'alert',
      arguments: [
        { type: 'variable', name: 'P' },
        { type: 'constant', value: 'diabetes_control' },
        { type: 'constant', value: 'medium' },
        { type: 'constant', value: 'Diabetic patient with poor glucose control' }
      ],
      negated: false
    },
    body: [
      {
        predicate: 'diagnosis',
        arguments: [
          { type: 'variable', name: 'P' },
          { type: 'constant', value: 'Type_2_Diabetes' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      },
      {
        predicate: 'lab_result',
        arguments: [
          { type: 'variable', name: 'P' },
          { type: 'constant', value: 'glucose' },
          { type: 'variable', name: 'G' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' },
          { type: 'variable', name: '_' }
        ],
        negated: false
      }
    ],
    defeasible: true,
    priority: 80,
    source: 'domain',
    explanationTemplate: 'Diabetic patient {P} has elevated glucose: {G} mg/dL - review treatment'
  }
];

/**
 * NL Templates for Clinical Queries
 */
export const clinicalTemplates: NLTemplate[] = [
  {
    id: 'clinical-001',
    pattern: 'Is (\w+) contraindicated for patient (\w+)',
    logicTemplate: 'contraindication($1, C), patient($2, _, _, _), diagnosis($2, C, _, _, _)?',
    variables: ['drug', 'patient_id'],
    confidenceBoost: 0.9
  },
  {
    id: 'clinical-002',
    pattern: 'Does patient (\w+) have any drug interactions',
    logicTemplate: 'medication($1, D1), medication($1, D2), drug_interaction(D1, D2, S, _), alert($1, "drug_interaction", S, _)?',
    variables: ['patient_id'],
    confidenceBoost: 0.85
  },
  {
    id: 'clinical-003',
    pattern: 'What are the alerts for patient (\w+)',
    logicTemplate: 'alert($1, T, S, M)?',
    variables: ['patient_id'],
    confidenceBoost: 0.9
  },
  {
    id: 'clinical-004',
    pattern: 'Is patient (\w+) allergic to (\w+)',
    logicTemplate: 'allergy($1, $2, S, _)?',
    variables: ['patient_id', 'allergen'],
    confidenceBoost: 0.95
  },
  {
    id: 'clinical-005',
    pattern: 'Check (\w+) compatibility for patient (\w+)',
    logicTemplate: 'medication($2, D), contraindication(D, C), diagnosis($2, C, _, _, _), violation("SAF-001", _, _)?',
    variables: ['drug', 'patient_id'],
    confidenceBoost: 0.9
  }
];

/**
 * Clinical Domain Ruleset
 */
export const clinicalRuleset: DomainRuleset = {
  domain: 'healthcare',
  displayName: 'Clinical Healthcare',
  description: 'Medical diagnosis verification, drug interactions, contraindications, and clinical alerts for patient safety',
  rules: clinicalRules,
  schema: clinicalSchema,
  templates: clinicalTemplates,
  isDefault: false,
  version: '1.0.0'
};

/**
 * Common drug interactions
 */
export const commonDrugInteractions = [
  { drug1: 'warfarin', drug2: 'aspirin', severity: 'major', mechanism: 'increased_bleeding_risk' },
  { drug1: 'warfarin', drug2: 'ibuprofen', severity: 'major', mechanism: 'increased_bleeding_risk' },
  { drug1: 'metformin', drug2: 'contrast_dye', severity: 'major', mechanism: 'lactic_acidosis' },
  { drug1: 'simvastatin', drug2: 'clarithromycin', severity: 'major', mechanism: 'rhabdomyolysis' },
  { drug1: 'lisinopril', drug2: 'spironolactone', severity: 'moderate', mechanism: 'hyperkalemia' }
];

/**
 * Contraindications database
 */
export const contraindications = [
  { drug: 'warfarin', condition: 'bleeding_disorder', severity: 'absolute', mechanism: 'increased_bleeding_risk' },
  { drug: 'metformin', condition: 'severe_renal_impairment', severity: 'absolute', mechanism: 'lactic_acidosis' },
  { drug: 'nsaids', condition: 'peptic_ulcer_disease', severity: 'relative', mechanism: 'gi_bleeding' },
  { drug: 'beta_blockers', condition: 'severe_bradycardia', severity: 'absolute', mechanism: 'heart_block' },
  { drug: 'ace_inhibitors', condition: 'angioedema_history', severity: 'absolute', mechanism: 'recurrent_angioedema' }
];

/**
 * Export drug interaction facts as Datalog
 */
export function getDrugInteractionFacts(): string {
  return commonDrugInteractions.map(
    i => `drug_interaction("${i.drug1}", "${i.drug2}", "${i.severity}", "${i.mechanism}").`
  ).join('\n');
}

/**
 * Export contraindication facts as Datalog
 */
export function getContraindicationFacts(): string {
  return contraindications.map(
    c => `contraindication("${c.drug}", "${c.condition}", "${c.severity}", "${c.mechanism}").`
  ).join('\n');
}
