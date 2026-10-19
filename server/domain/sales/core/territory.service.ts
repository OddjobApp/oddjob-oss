import { db } from "@server/database_service.js";
import { territories } from "@shared/schema/territory.js";
import { eq } from "drizzle-orm";

class TerritoryService {
  async createTerritory(name: string, description: string, rules: any) {
    const [newTerritory] = await db.insert(territories).values({ name, description, rules }).returning();
    return newTerritory;
  }

  async updateTerritory(id: number, name: string, description: string, rules: any) {
    const [updatedTerritory] = await db.update(territories).set({ name, description, rules }).where(eq(territories.id, id)).returning();
    return updatedTerritory;
  }

  async deleteTerritory(id: number) {
    await db.delete(territories).where(eq(territories.id, id));
  }

  async assignToTerritory(record: any): Promise<number | null> {
    const allTerritories = await db.select().from(territories);
    for (const territory of allTerritories) {
      if (this.matches(record, territory.rules)) {
        return territory.id;
      }
    }
    return null;
  }

  private matches(record: any, rules: any): boolean {
    for (const key in rules) {
      if (record[key] !== rules[key]) {
        return false;
      }
    }
    return true;
  }
}

export { TerritoryService };