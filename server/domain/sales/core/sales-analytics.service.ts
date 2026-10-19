import { db } from "@server/database_service.js";
import { sql } from "drizzle-orm";

class SalesAnalyticsService {
  async getWinLossRate() {
    const query = `
      SELECT
        product_id,
        reason,
        COUNT(CASE WHEN status = 'won' THEN 1 END) AS wins,
        COUNT(CASE WHEN status = 'lost' THEN 1 END) AS losses
      FROM opportunities
      GROUP BY product_id, reason
    `;
    const result = await db.execute(sql.raw(query));
    return result.rows;
  }

  async getSalesCycleDuration() {
    const query = `
      SELECT
        product_id,
        AVG(closed_at - created_at) AS avg_sales_cycle_duration
      FROM opportunities
      WHERE status = 'won'
      GROUP BY product_id
    `;
    const result = await db.execute(sql.raw(query));
    return result.rows;
  }

  async getSalesRepPerformance() {
    const query = `
      SELECT
        sales_rep_id,
        COUNT(CASE WHEN status = 'won' THEN 1 END) AS deals_won,
        SUM(CASE WHEN status = 'won' THEN amount ELSE 0 END) AS total_deal_value,
        AVG(CASE WHEN status = 'won' THEN amount ELSE 0 END) AS avg_deal_size
      FROM opportunities
      GROUP BY sales_rep_id
    `;
    const result = await db.execute(sql.raw(query));
    return result.rows;
  }
}

export { SalesAnalyticsService };