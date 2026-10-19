import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PulseService");
const PULSE_WINDOW_MS = 300000; // 5 minutes history for LLM context

export interface UserPulse {
  f_id: string; // fingerprint
  session_id: string;
  r_path: string; // route
  r_desc: string; // route description
  act_id: string; // action id (click, hover, etc.)
  ts: number;
  type?: string;
  ctx?: Record<string, any>;
}

export const pulseService = {
  /**
   * Records a user pulse into a sliding window (Redis list).
   */
  async recordPulse(pulse: UserPulse): Promise<void> {
    const key = `pulse:history:${pulse.f_id}`;
    
    // Store pulse as JSON
    const data = JSON.stringify(pulse);
    
    await redis.lpush(key, data);
    
    // Trim list to keep only recent ones (e.g., last 20 pulses)
    await redis.ltrim(key, 0, 19);
    
    // Expire the key after 5 minutes of inactivity
    await redis.expire(key, 300);
    
    logger.debug(`Recorded pulse for ${pulse.f_id}: ${pulse.act_id} on ${pulse.r_path}`);
  },

  /**
   * Fetches the recent pulse history for context injection.
   */
  async getRecentActivity(fingerprint: string): Promise<UserPulse[]> {
    const key = `pulse:history:${fingerprint}`;
    
    const results = await redis.lrange(key, 0, -1);
    return results.map((r: string) => JSON.parse(r) as UserPulse);
  },

  /**
   * Summarizes user activity for the LLM.
   */
  async summarizeRecentActivity(fingerprint: string): Promise<string> {
    const pulses = await this.getRecentActivity(fingerprint);
    if (pulses.length === 0) return "No recent platform activity recorded.";

    const breakdown = pulses.slice(0, 10).map(p => {
        const time = new Date(p.ts).toLocaleTimeString();
        let desc = `- [${time}] ${p.act_id || 'Viewed'} on ${p.r_desc || p.r_path}`;
        if (p.ctx?.element_label) desc += ` (Interacted with: "${p.ctx.element_label}")`;
        return desc;
    }).join('\n');

    return `Recent Platform Activity (Last 5 mins):\n${breakdown}`;
  }
};


