
/**
 * Determines trace sampling based on the source of the execution
 */
export function shouldSample(traceSource: 'manual' | 'schedule' | 'webhook' | 'api'): boolean {
    // Always sample manual runs and API triggers for debugging visibility
    if (traceSource === 'manual' || traceSource === 'api') {
        return true;
    }

    // Get sample rate from environment or default to 10% (0.1)
    // This allows tuning production volume
    const sampleRate = parseFloat(process.env.TRACE_SAMPLE_RATE || '0.1');

    // Random sampling for automated high-volume triggers
    return Math.random() < sampleRate;
}




