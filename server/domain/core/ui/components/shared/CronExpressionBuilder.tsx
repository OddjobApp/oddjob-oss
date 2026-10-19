import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';

interface CronFieldConfig {
  mode: string;
  value: string;
  specific: number[];
  from: number;
  to: number;
  interval: number;
}

interface CronExpressionBuilderProps {
  value: string;
  onChange: (expression: string) => void;
  onValidationError?: (error: string) => void;
  testIdPrefix?: string;
}

export default function CronExpressionBuilder({ 
  value, 
  onChange, 
  onValidationError,
  testIdPrefix = 'cron' 
}: CronExpressionBuilderProps) {
  // Track the last expression we generated to avoid re-parsing our own updates
  const lastGeneratedExpressionRef = useRef<string>('');
  
  // Cron field builder state
  const [cronMinute, setCronMinute] = useState<CronFieldConfig>({ mode: 'every', value: '*', specific: [], from: 0, to: 59, interval: 1 });
  const [cronHour, setCronHour] = useState<CronFieldConfig>({ mode: 'every', value: '*', specific: [], from: 0, to: 23, interval: 1 });
  const [cronDayOfMonth, setCronDayOfMonth] = useState<CronFieldConfig>({ mode: 'every', value: '*', specific: [], from: 1, to: 31, interval: 1 });
  const [cronMonth, setCronMonth] = useState<CronFieldConfig>({ mode: 'every', value: '*', specific: [], from: 1, to: 12, interval: 1 });
  const [cronDayOfWeek, setCronDayOfWeek] = useState<CronFieldConfig>({ mode: 'every', value: '*', specific: [], from: 0, to: 6, interval: 1 });

  // Parse a single cron field into builder configuration
  const parseCronField = (token: string, min: number, max: number): CronFieldConfig & { unsupported: boolean } => {
    const trimmed = token.trim();
    
    // Every (*)
    if (trimmed === '*') {
      return { mode: 'every', value: '*', specific: [], from: min, to: max, interval: 1, unsupported: false };
    }
    
    // Interval (*/n)
    const intervalMatch = trimmed.match(/^\*\/(\d+)$/);
    if (intervalMatch) {
      const interval = parseInt(intervalMatch[1], 10);
      if (interval >= 1 && interval <= max) {
        return { mode: 'interval', value: trimmed, specific: [], from: min, to: max, interval, unsupported: false };
      }
    }
    
    // Range (n-m)
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1], 10);
      const to = parseInt(rangeMatch[2], 10);
      if (from >= min && from <= max && to >= min && to <= max && from <= to) {
        return { mode: 'range', value: trimmed, specific: [], from, to, interval: 1, unsupported: false };
      }
    }
    
    // Specific (n or n,m,...)
    const specificMatch = trimmed.match(/^(\d+)(,\d+)*$/);
    if (specificMatch) {
      const values = trimmed.split(',').map(v => parseInt(v.trim(), 10));
      const allValid = values.every(v => v >= min && v <= max);
      if (allValid && values.length > 0) {
        return { mode: 'specific', value: trimmed, specific: values, from: min, to: max, interval: 1, unsupported: false };
      }
    }
    
    // Unsupported or invalid syntax - default to 'every'
    return { mode: 'every', value: '*', specific: [], from: min, to: max, interval: 1, unsupported: true };
  };

  // Parse full cron expression into field configurations
  const parseCronExpression = (expression: string): { configs: CronFieldConfig[]; hasUnsupported: boolean } => {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
      // Invalid format - return defaults
      return {
        configs: [
          { mode: 'every', value: '*', specific: [], from: 0, to: 59, interval: 1 },
          { mode: 'every', value: '*', specific: [], from: 0, to: 23, interval: 1 },
          { mode: 'every', value: '*', specific: [], from: 1, to: 31, interval: 1 },
          { mode: 'every', value: '*', specific: [], from: 1, to: 12, interval: 1 },
          { mode: 'every', value: '*', specific: [], from: 0, to: 6, interval: 1 },
        ],
        hasUnsupported: true,
      };
    }
    
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const minuteConfig = parseCronField(minute, 0, 59);
    const hourConfig = parseCronField(hour, 0, 23);
    const dayOfMonthConfig = parseCronField(dayOfMonth, 1, 31);
    const monthConfig = parseCronField(month, 1, 12);
    const dayOfWeekConfig = parseCronField(dayOfWeek, 0, 6);
    
    const hasUnsupported = [minuteConfig, hourConfig, dayOfMonthConfig, monthConfig, dayOfWeekConfig].some(c => c.unsupported);
    
    return {
      configs: [minuteConfig, hourConfig, dayOfMonthConfig, monthConfig, dayOfWeekConfig],
      hasUnsupported,
    };
  };

  // Sync with prop value only when it differs from our last generated expression
  useEffect(() => {
    const incomingValue = value || '0 * * * *';
    
    // Only re-parse if the incoming value is different from what we last generated
    // This prevents feedback loops while allowing external updates (e.g., editing different schedules)
    if (incomingValue !== lastGeneratedExpressionRef.current) {
      const { configs, hasUnsupported } = parseCronExpression(incomingValue);
      setCronMinute(configs[0]);
      setCronHour(configs[1]);
      setCronDayOfMonth(configs[2]);
      setCronMonth(configs[3]);
      setCronDayOfWeek(configs[4]);
      
      // Update the ref to track this parsed value
      lastGeneratedExpressionRef.current = incomingValue;
      
      if (hasUnsupported && onValidationError) {
        onValidationError('Warning: Some cron syntax is not supported by the visual editor. Fields with unsupported syntax have been reset to default values.');
      } else if (onValidationError) {
        onValidationError('');
      }
    }
  }, [value, onValidationError]);

  // Validate range inputs
  const isValidRange = (from: number, to: number): boolean => {
    return Number.isFinite(from) && Number.isFinite(to) && from <= to;
  };
  
  // Check if value is a valid numeric input (excludes 0 which is treated as unset)
  const isValidNumeric = (value: any): boolean => {
    return value != null && Number.isFinite(value) && value !== 0;
  };

  // Generate cron field value from config
  const generateCronField = (config: CronFieldConfig): string => {
    switch (config.mode) {
      case 'every':
        return '*';
      case 'specific':
        if (!config.specific || config.specific.length === 0) {
          return '*';
        }
        // Filter out non-finite values
        const validSpecific = config.specific.filter((v: any) => Number.isFinite(v));
        return validSpecific.length > 0 ? validSpecific.sort((a: number, b: number) => a - b).join(',') : '*';
      case 'range':
        // Validate range before generating - check for NaN/Infinity
        if (!isValidRange(config.from, config.to)) {
          return '*'; // Fallback to 'every' if invalid, missing, or NaN/Infinity
        }
        return `${config.from}-${config.to}`;
      case 'interval':
        // Check for valid positive finite number
        if (!isValidNumeric(config.interval) || config.interval <= 0) {
          return '*';
        }
        return `*/${config.interval}`;
      default:
        return '*';
    }
  };

  // Generate full cron expression from all field configs
  const generateCronExpression = (): string => {
    const minute = generateCronField(cronMinute);
    const hour = generateCronField(cronHour);
    const dayOfMonth = generateCronField(cronDayOfMonth);
    const month = generateCronField(cronMonth);
    const dayOfWeek = generateCronField(cronDayOfWeek);
    return `${minute} ${hour} ${dayOfMonth} ${month} ${dayOfWeek}`;
  };

  // Update parent when cron fields change
  const updateCronExpression = () => {
    const expression = generateCronExpression();
    // Update the ref before calling onChange to prevent feedback loop
    lastGeneratedExpressionRef.current = expression;
    onChange(expression);
    // Clear validation errors when user modifies fields
    if (onValidationError) {
      onValidationError('');
    }
  };

  // Generate human-readable description from cron field configs
  const generateCronDescription = (): string => {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    const describeField = (config: CronFieldConfig, fieldType: string): string => {
      const formatList = (items: number[], names?: string[]) => {
        if (items.length === 0) return '';
        const mapped = names ? items.map(i => names[i - (fieldType === 'month' ? 1 : 0)]) : items;
        if (mapped.length === 1) return mapped[0].toString();
        if (mapped.length === 2) return `${mapped[0]} and ${mapped[1]}`;
        return `${mapped.slice(0, -1).join(', ')}, and ${mapped[mapped.length - 1]}`;
      };

      switch (config.mode) {
        case 'every':
          if (fieldType === 'minute') return 'every minute';
          if (fieldType === 'hour') return 'every hour';
          if (fieldType === 'dayofmonth') return 'every day';
          if (fieldType === 'month') return 'every month';
          if (fieldType === 'dayofweek') return 'every day of the week';
          return '';
        
        case 'specific':
          if (config.specific.length === 0) {
            return describeField({ ...config, mode: 'every' }, fieldType);
          }
          if (fieldType === 'minute') {
            return config.specific.length === 1 
              ? `at minute ${config.specific[0]}`
              : `at minutes ${formatList(config.specific)}`;
          }
          if (fieldType === 'hour') {
            return config.specific.length === 1
              ? `at ${config.specific[0]}:00`
              : `at hours ${formatList(config.specific)}`;
          }
          if (fieldType === 'dayofmonth') {
            return config.specific.length === 1
              ? `on day ${config.specific[0]}`
              : `on days ${formatList(config.specific)}`;
          }
          if (fieldType === 'month') {
            return config.specific.length === 1
              ? `in ${monthNames[config.specific[0] - 1]}`
              : `in ${formatList(config.specific, monthNames)}`;
          }
          if (fieldType === 'dayofweek') {
            return config.specific.length === 1
              ? `on ${dayNames[config.specific[0]]}`
              : `on ${formatList(config.specific, dayNames)}`;
          }
          return '';
        
        case 'range':
          if (fieldType === 'minute') return `between minutes ${config.from} and ${config.to}`;
          if (fieldType === 'hour') return `between ${config.from}:00 and ${config.to}:00`;
          if (fieldType === 'dayofmonth') return `between days ${config.from} and ${config.to}`;
          if (fieldType === 'month') return `between ${monthNames[config.from - 1]} and ${monthNames[config.to - 1]}`;
          if (fieldType === 'dayofweek') return `between ${dayNames[config.from]} and ${dayNames[config.to]}`;
          return '';
        
        case 'interval':
          if (fieldType === 'minute') return `every ${config.interval} minute${config.interval > 1 ? 's' : ''}`;
          if (fieldType === 'hour') return `every ${config.interval} hour${config.interval > 1 ? 's' : ''}`;
          if (fieldType === 'dayofmonth') return `every ${config.interval} day${config.interval > 1 ? 's' : ''}`;
          if (fieldType === 'month') return `every ${config.interval} month${config.interval > 1 ? 's' : ''}`;
          if (fieldType === 'dayofweek') return `every ${config.interval} day${config.interval > 1 ? 's' : ''} of the week`;
          return '';
        
        default:
          return '';
      }
    };

    const minuteDesc = describeField(cronMinute, 'minute');
    const hourDesc = describeField(cronHour, 'hour');
    const dayOfMonthDesc = describeField(cronDayOfMonth, 'dayofmonth');
    const monthDesc = describeField(cronMonth, 'month');
    const dayOfWeekDesc = describeField(cronDayOfWeek, 'dayofweek');

    // Build the description sentence
    const parts: string[] = [];
    
    // Start with minute/hour timing
    if (minuteDesc && hourDesc) {
      if (cronMinute.mode === 'every' && cronHour.mode === 'every') {
        parts.push('Every minute');
      } else if (cronMinute.mode === 'every') {
        // minute=* with constrained hours
        if (cronHour.mode === 'specific') {
          if (cronHour.specific.length === 1) {
            parts.push(`Every minute during the ${cronHour.specific[0]}:00 hour`);
          } else {
            const hourList = cronHour.specific.map(h => `${h}:00`).join(', ');
            parts.push(`Every minute during hours ${hourList}`);
          }
        } else if (cronHour.mode === 'range') {
          parts.push(`Every minute between ${cronHour.from}:00 and ${cronHour.to}:00`);
        } else if (cronHour.mode === 'interval') {
          parts.push(`Every minute, every ${cronHour.interval} hour${cronHour.interval > 1 ? 's' : ''}`);
        }
      } else if (cronHour.mode === 'every') {
        // Constrained minutes with hour=*
        if (cronMinute.mode === 'specific') {
          if (cronMinute.specific.length === 1) {
            parts.push(`At minute ${cronMinute.specific[0]} of every hour`);
          } else {
            parts.push(`At minutes ${cronMinute.specific.join(', ')} of every hour`);
          }
        } else if (cronMinute.mode === 'range') {
          parts.push(`Between minutes ${cronMinute.from} and ${cronMinute.to} of every hour`);
        } else if (cronMinute.mode === 'interval') {
          parts.push(`Every ${cronMinute.interval} minute${cronMinute.interval > 1 ? 's' : ''}`);
        }
      } else {
        // Both constrained: combine naturally
        if (cronMinute.mode === 'specific' && cronHour.mode === 'specific') {
          const times: string[] = [];
          cronHour.specific.forEach(h => {
            cronMinute.specific.forEach(m => {
              times.push(`${h}:${m.toString().padStart(2, '0')}`);
            });
          });
          if (times.length === 1) {
            parts.push(`At ${times[0]}`);
          } else {
            parts.push(`At ${times.join(', ')}`);
          }
        } else if (cronMinute.mode === 'interval' && cronHour.mode === 'specific') {
          if (cronHour.specific.length === 1) {
            parts.push(`Every ${cronMinute.interval} minute${cronMinute.interval > 1 ? 's' : ''} during the ${cronHour.specific[0]}:00 hour`);
          } else {
            const hourList = cronHour.specific.map(h => `${h}:00`).join(', ');
            parts.push(`Every ${cronMinute.interval} minute${cronMinute.interval > 1 ? 's' : ''} during hours ${hourList}`);
          }
        } else if (cronMinute.mode === 'interval' && cronHour.mode === 'range') {
          parts.push(`Every ${cronMinute.interval} minute${cronMinute.interval > 1 ? 's' : ''} between ${cronHour.from}:00 and ${cronHour.to}:00`);
        } else if (cronMinute.mode === 'range' && cronHour.mode === 'specific') {
          if (cronHour.specific.length === 1) {
            parts.push(`Between minutes ${cronMinute.from} and ${cronMinute.to} during the ${cronHour.specific[0]}:00 hour`);
          } else {
            const hourList = cronHour.specific.map(h => `${h}:00`).join(', ');
            parts.push(`Between minutes ${cronMinute.from} and ${cronMinute.to} during hours ${hourList}`);
          }
        } else {
          parts.push(`${minuteDesc.charAt(0).toUpperCase() + minuteDesc.slice(1)} ${hourDesc}`);
        }
      }
    }

    // Handle day-of-month and day-of-week (cron OR semantics)
    const hasDayOfMonth = dayOfMonthDesc && dayOfMonthDesc !== 'every day';
    const hasDayOfWeek = dayOfWeekDesc && dayOfWeekDesc !== 'every day of the week';
    
    if (hasDayOfMonth && hasDayOfWeek) {
      parts.push(`when either ${dayOfMonthDesc} OR ${dayOfWeekDesc}`);
    } else if (hasDayOfMonth) {
      parts.push(dayOfMonthDesc);
    } else if (hasDayOfWeek) {
      parts.push(dayOfWeekDesc);
    }

    // Add month constraints
    if (monthDesc && monthDesc !== 'every month') {
      parts.push(monthDesc);
    }

    return parts.join(', ') || 'Every minute';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cron Expression Builder</CardTitle>
        <CardDescription>
          Configure each field to build your custom schedule
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Minute Field */}
        <div className="space-y-3 p-4 border rounded-lg">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Minute (0-59)</Label>
            <code className="text-xs bg-muted px-2 py-1 rounded">{generateCronField(cronMinute)}</code>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select 
              value={cronMinute.mode} 
              onValueChange={(value) => {
                setCronMinute({ ...cronMinute, mode: value });
                setTimeout(updateCronExpression, 0);
              }}
            >
              <SelectTrigger data-testid={`${testIdPrefix}-select-minute-mode`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="every">Every minute</SelectItem>
                <SelectItem value="specific">Specific minutes</SelectItem>
                <SelectItem value="range">Range</SelectItem>
                <SelectItem value="interval">Every N minutes</SelectItem>
              </SelectContent>
            </Select>
            {cronMinute.mode === 'specific' && (
              <Input
                placeholder="e.g., 0,15,30,45"
                value={cronMinute.specific.join(',')}
                onChange={(e) => {
                  const vals = e.target.value.split(',').map(v => parseInt(v.trim())).filter(n => !isNaN(n) && n >= 0 && n <= 59);
                  setCronMinute({ ...cronMinute, specific: vals });
                  setTimeout(updateCronExpression, 0);
                }}
                data-testid={`${testIdPrefix}-input-minute-specific`}
              />
            )}
            {cronMinute.mode === 'range' && (
              <>
                <Input
                  type="number"
                  placeholder="From"
                  min={0}
                  max={59}
                  value={cronMinute.from}
                  onChange={(e) => {
                    setCronMinute({ ...cronMinute, from: Number(e.target.value) });
                    setTimeout(updateCronExpression, 0);
                  }}
                  data-testid={`${testIdPrefix}-input-minute-from`}
                />
                <Input
                  type="number"
                  placeholder="To"
                  min={0}
                  max={59}
                  value={cronMinute.to}
                  onChange={(e) => {
                    setCronMinute({ ...cronMinute, to: Number(e.target.value) });
                    setTimeout(updateCronExpression, 0);
                  }}
                  data-testid={`${testIdPrefix}-input-minute-to`}
                />
              </>
            )}
            {cronMinute.mode === 'interval' && (
              <Input
                type="number"
                placeholder="Interval"
                min={1}
                max={59}
                value={cronMinute.interval}
                onChange={(e) => {
                  setCronMinute({ ...cronMinute, interval: Number(e.target.value) });
                  setTimeout(updateCronExpression, 0);
                }}
                data-testid={`${testIdPrefix}-input-minute-interval`}
              />
            )}
          </div>
        </div>

        {/* Hour Field */}
        <div className="space-y-3 p-4 border rounded-lg">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Hour (0-23)</Label>
            <code className="text-xs bg-muted px-2 py-1 rounded">{generateCronField(cronHour)}</code>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select 
              value={cronHour.mode} 
              onValueChange={(value) => {
                setCronHour({ ...cronHour, mode: value });
                setTimeout(updateCronExpression, 0);
              }}
            >
              <SelectTrigger data-testid={`${testIdPrefix}-select-hour-mode`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="every">Every hour</SelectItem>
                <SelectItem value="specific">Specific hours</SelectItem>
                <SelectItem value="range">Range</SelectItem>
                <SelectItem value="interval">Every N hours</SelectItem>
              </SelectContent>
            </Select>
            {cronHour.mode === 'specific' && (
              <Input
                placeholder="e.g., 0,6,12,18"
                value={cronHour.specific.join(',')}
                onChange={(e) => {
                  const vals = e.target.value.split(',').map(v => parseInt(v.trim())).filter(n => !isNaN(n) && n >= 0 && n <= 23);
                  setCronHour({ ...cronHour, specific: vals });
                  setTimeout(updateCronExpression, 0);
                }}
                data-testid={`${testIdPrefix}-input-hour-specific`}
              />
            )}
            {cronHour.mode === 'range' && (
              <>
                <Input
                  type="number"
                  placeholder="From"
                  min={0}
                  max={23}
                  value={cronHour.from}
                  onChange={(e) => {
                    setCronHour({ ...cronHour, from: Number(e.target.value) });
                    setTimeout(updateCronExpression, 0);
                  }}
                  data-testid={`${testIdPrefix}-input-hour-from`}
                />
                <Input
                  type="number"
                  placeholder="To"
                  min={0}
                  max={23}
                  value={cronHour.to}
                  onChange={(e) => {
                    setCronHour({ ...cronHour, to: Number(e.target.value) });
                    setTimeout(updateCronExpression, 0);
                  }}
                  data-testid={`${testIdPrefix}-input-hour-to`}
                />
              </>
            )}
            {cronHour.mode === 'interval' && (
              <Input
                type="number"
                placeholder="Interval"
                min={1}
                max={23}
                value={cronHour.interval}
                onChange={(e) => {
                  setCronHour({ ...cronHour, interval: Number(e.target.value) });
                  setTimeout(updateCronExpression, 0);
                }}
                data-testid={`${testIdPrefix}-input-hour-interval`}
              />
            )}
          </div>
        </div>

        {/* Day of Month Field */}
        <div className="space-y-3 p-4 border rounded-lg">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Day of Month (1-31)</Label>
            <code className="text-xs bg-muted px-2 py-1 rounded">{generateCronField(cronDayOfMonth)}</code>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select 
              value={cronDayOfMonth.mode} 
              onValueChange={(value) => {
                setCronDayOfMonth({ ...cronDayOfMonth, mode: value });
                setTimeout(updateCronExpression, 0);
              }}
            >
              <SelectTrigger data-testid={`${testIdPrefix}-select-dayofmonth-mode`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="every">Every day</SelectItem>
                <SelectItem value="specific">Specific days</SelectItem>
                <SelectItem value="range">Range</SelectItem>
                <SelectItem value="interval">Every N days</SelectItem>
              </SelectContent>
            </Select>
            {cronDayOfMonth.mode === 'specific' && (
              <Input
                placeholder="e.g., 1,15"
                value={cronDayOfMonth.specific.join(',')}
                onChange={(e) => {
                  const vals = e.target.value.split(',').map(v => parseInt(v.trim())).filter(n => !isNaN(n) && n >= 1 && n <= 31);
                  setCronDayOfMonth({ ...cronDayOfMonth, specific: vals });
                  setTimeout(updateCronExpression, 0);
                }}
                data-testid={`${testIdPrefix}-input-dayofmonth-specific`}
              />
            )}
            {cronDayOfMonth.mode === 'range' && (
              <>
                <Input
                  type="number"
                  placeholder="From"
                  min={1}
                  max={31}
                  value={cronDayOfMonth.from}
                  onChange={(e) => {
                    setCronDayOfMonth({ ...cronDayOfMonth, from: Number(e.target.value) });
                    setTimeout(updateCronExpression, 0);
                  }}
                  data-testid={`${testIdPrefix}-input-dayofmonth-from`}
                />
                <Input
                  type="number"
                  placeholder="To"
                  min={1}
                  max={31}
                  value={cronDayOfMonth.to}
                  onChange={(e) => {
                    setCronDayOfMonth({ ...cronDayOfMonth, to: Number(e.target.value) });
                    setTimeout(updateCronExpression, 0);
                  }}
                  data-testid={`${testIdPrefix}-input-dayofmonth-to`}
                />
              </>
            )}
            {cronDayOfMonth.mode === 'interval' && (
              <Input
                type="number"
                placeholder="Interval"
                min={1}
                max={31}
                value={cronDayOfMonth.interval}
                onChange={(e) => {
                  setCronDayOfMonth({ ...cronDayOfMonth, interval: Number(e.target.value) });
                  setTimeout(updateCronExpression, 0);
                }}
                data-testid={`${testIdPrefix}-input-dayofmonth-interval`}
              />
            )}
          </div>
        </div>

        {/* Month Field */}
        <div className="space-y-3 p-4 border rounded-lg">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Month (1-12)</Label>
            <code className="text-xs bg-muted px-2 py-1 rounded">{generateCronField(cronMonth)}</code>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select 
              value={cronMonth.mode} 
              onValueChange={(value) => {
                setCronMonth({ ...cronMonth, mode: value });
                setTimeout(updateCronExpression, 0);
              }}
            >
              <SelectTrigger data-testid={`${testIdPrefix}-select-month-mode`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="every">Every month</SelectItem>
                <SelectItem value="specific">Specific months</SelectItem>
                <SelectItem value="range">Range</SelectItem>
                <SelectItem value="interval">Every N months</SelectItem>
              </SelectContent>
            </Select>
            {cronMonth.mode === 'specific' && (
              <Input
                placeholder="e.g., 1,6,12"
                value={cronMonth.specific.join(',')}
                onChange={(e) => {
                  const vals = e.target.value.split(',').map(v => parseInt(v.trim())).filter(n => !isNaN(n) && n >= 1 && n <= 12);
                  setCronMonth({ ...cronMonth, specific: vals });
                  setTimeout(updateCronExpression, 0);
                }}
                data-testid={`${testIdPrefix}-input-month-specific`}
              />
            )}
            {cronMonth.mode === 'range' && (
              <>
                <Input
                  type="number"
                  placeholder="From"
                  min={1}
                  max={12}
                  value={cronMonth.from}
                  onChange={(e) => {
                    setCronMonth({ ...cronMonth, from: Number(e.target.value) });
                    setTimeout(updateCronExpression, 0);
                  }}
                  data-testid={`${testIdPrefix}-input-month-from`}
                />
                <Input
                  type="number"
                  placeholder="To"
                  min={1}
                  max={12}
                  value={cronMonth.to}
                  onChange={(e) => {
                    setCronMonth({ ...cronMonth, to: Number(e.target.value) });
                    setTimeout(updateCronExpression, 0);
                  }}
                  data-testid={`${testIdPrefix}-input-month-to`}
                />
              </>
            )}
            {cronMonth.mode === 'interval' && (
              <Input
                type="number"
                placeholder="Interval"
                min={1}
                max={12}
                value={cronMonth.interval}
                onChange={(e) => {
                  setCronMonth({ ...cronMonth, interval: Number(e.target.value) });
                  setTimeout(updateCronExpression, 0);
                }}
                data-testid={`${testIdPrefix}-input-month-interval`}
              />
            )}
          </div>
        </div>

        {/* Day of Week Field */}
        <div className="space-y-3 p-4 border rounded-lg">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Day of Week (0-6, Sun-Sat)</Label>
            <code className="text-xs bg-muted px-2 py-1 rounded">{generateCronField(cronDayOfWeek)}</code>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select 
              value={cronDayOfWeek.mode} 
              onValueChange={(value) => {
                setCronDayOfWeek({ ...cronDayOfWeek, mode: value });
                setTimeout(updateCronExpression, 0);
              }}
            >
              <SelectTrigger data-testid={`${testIdPrefix}-select-dayofweek-mode`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="every">Every day</SelectItem>
                <SelectItem value="specific">Specific days</SelectItem>
                <SelectItem value="range">Range</SelectItem>
                <SelectItem value="interval">Every N days</SelectItem>
              </SelectContent>
            </Select>
            {cronDayOfWeek.mode === 'specific' && (
              <Input
                placeholder="e.g., 1,3,5 (Mon,Wed,Fri)"
                value={cronDayOfWeek.specific.join(',')}
                onChange={(e) => {
                  const vals = e.target.value.split(',').map(v => parseInt(v.trim())).filter(n => !isNaN(n) && n >= 0 && n <= 6);
                  setCronDayOfWeek({ ...cronDayOfWeek, specific: vals });
                  setTimeout(updateCronExpression, 0);
                }}
                data-testid={`${testIdPrefix}-input-dayofweek-specific`}
              />
            )}
            {cronDayOfWeek.mode === 'range' && (
              <>
                <Input
                  type="number"
                  placeholder="From"
                  min={0}
                  max={6}
                  value={cronDayOfWeek.from}
                  onChange={(e) => {
                    setCronDayOfWeek({ ...cronDayOfWeek, from: Number(e.target.value) });
                    setTimeout(updateCronExpression, 0);
                  }}
                  data-testid={`${testIdPrefix}-input-dayofweek-from`}
                />
                <Input
                  type="number"
                  placeholder="To"
                  min={0}
                  max={6}
                  value={cronDayOfWeek.to}
                  onChange={(e) => {
                    setCronDayOfWeek({ ...cronDayOfWeek, to: Number(e.target.value) });
                    setTimeout(updateCronExpression, 0);
                  }}
                  data-testid={`${testIdPrefix}-input-dayofweek-to`}
                />
              </>
            )}
            {cronDayOfWeek.mode === 'interval' && (
              <Input
                type="number"
                placeholder="Interval"
                min={1}
                max={6}
                value={cronDayOfWeek.interval}
                onChange={(e) => {
                  setCronDayOfWeek({ ...cronDayOfWeek, interval: Number(e.target.value) });
                  setTimeout(updateCronExpression, 0);
                }}
                data-testid={`${testIdPrefix}-input-dayofweek-interval`}
              />
            )}
          </div>
        </div>

        {/* Generated Expression Preview */}
        <div className="space-y-3 p-4 bg-primary/5 border-2 border-primary/20 rounded-lg">
          <Label className="text-sm font-semibold">Generated Cron Expression</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-background border rounded font-mono text-sm">
              {generateCronExpression()}
            </code>
          </div>
          <div className="text-sm text-muted-foreground">
            {generateCronDescription()}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
