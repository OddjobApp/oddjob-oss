import type { ConditionGroup } from './RuleBuilder';

/** A new rule must not imply any customer intent before the user adds it. */
export function createEmptyRuleTree(): ConditionGroup {
  return {
    id: 'root-and',
    type: 'group',
    logic: 'AND',
    children: [],
  };
}

/**
 * Production H3 Geo Event Rule for the Commercial Generator #4 Telemetry Breach (Site 4 Power Station, Los Angeles, CA).
 * Evaluates H3 res-9 geofence, ON_DWELL SLA threshold (>10 min), critical severity,
 * Operational_Disruption event classification, and telemetry thermal limit exceedance (>95°C).
 */
export function createRescueDispatchGeoRuleTree(): ConditionGroup {
  return {
    id: 'root-geo-rule',
    type: 'group',
    logic: 'AND',
    children: [
      {
        id: 'cond-geo-h3-fence',
        type: 'condition',
        field: 'spatial_drift > h3_resolution',
        operator: 'in',
        value: '8828308281fffff',
        label: 'H3 Res-9 Sector "8828308281fffff" (Site 4 Power Station - Los Angeles, CA)',
        evaluatorType: 'anomaly_scorer',
        config: {
          spatialRegionName: 'Site 4 Power Station (Los Angeles, CA)',
          centerLat: 34.0522,
          centerLng: -118.2437,
          h3Resolution: 'Res 9 (~170m)',
          selectedHexes: ['8828308281fffff'],
          value: '8828308281fffff',
          spatialCondition: {
            type: 'spatial',
            mode: 'geofence_trigger',
            trigger: 'ON_DWELL',
            dwellSlaMinutes: 10,
            predicate: 'there',
            conditionId: 'cond-geo-h3-fence',
            label: 'H3 Res-9 Geofence & Dwell SLA (>10m)',
            geometry: {
              regionName: 'Site 4 Power Station (Los Angeles, CA)',
              h3Cells: ['8828308281fffff'],
              centerLat: 34.0522,
              centerLng: -118.2437,
            },
          },
        },
      },
      {
        id: 'cond-geo-dwell-sla',
        type: 'condition',
        field: 'dwellMinutes',
        operator: '>=',
        value: '10.0',
        label: 'dwellMinutes >= 10.0 min (SLA Threshold Exceeded)',
        evaluatorType: 'field_threshold',
        config: {
          field: 'dwellMinutes',
          operator: '>=',
          value: '10.0',
        },
      },
      {
        id: 'cond-geo-severity',
        type: 'condition',
        field: 'severity',
        operator: 'equals',
        value: 'CRITICAL',
        label: 'severity equals "CRITICAL"',
        evaluatorType: 'field_threshold',
        config: {
          field: 'severity',
          operator: 'equals',
          value: 'CRITICAL',
        },
      },
      {
        id: 'cond-geo-event-type',
        type: 'condition',
        field: 'eventType',
        operator: 'equals',
        value: 'Operational_Disruption',
        label: 'eventType equals "Operational_Disruption"',
        evaluatorType: 'field_threshold',
        config: {
          field: 'eventType',
          operator: 'equals',
          value: 'Operational_Disruption',
        },
      },
      {
        id: 'cond-geo-thermal-anomaly',
        type: 'condition',
        field: 'rawText',
        operator: 'contains',
        value: '104.2°C',
        label: 'rawText contains "104.2°C" (Core Temp > 95°C Limit)',
        evaluatorType: 'field_threshold',
        config: {
          field: 'rawText',
          operator: 'contains',
          value: '104.2°C',
        },
      },
    ],
  };
}

