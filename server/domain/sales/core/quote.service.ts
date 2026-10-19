import { db } from "@server/database_service.js";
import { quotes } from "@shared/schema/quote.js";
import { eq } from "drizzle-orm";

class QuoteService {
  async createQuote(quoteNumber: string, opportunityId: number, lineItems: any) {
    const [newQuote] = await db.insert(quotes).values({ quoteNumber, opportunityId, lineItems }).returning();
    return newQuote;
  }

  async updateQuote(id: number, quoteNumber: string, opportunityId: number, lineItems: any) {
    const [updatedQuote] = await db.update(quotes).set({ quoteNumber, opportunityId, lineItems }).where(eq(quotes.id, id)).returning();
    return updatedQuote;
  }

  async deleteQuote(id: number) {
    await db.delete(quotes).where(eq(quotes.id, id));
  }

  async generateQuoteDocument(id: number): Promise<string> {
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, id));
    // In a real application, this would generate a PDF or other document format.
    // For this example, we'll just return a string.
    return `Quote #${quote.quoteNumber}\n\nLine Items:\n${JSON.stringify(quote.lineItems, null, 2)}`;
  }
}

export { QuoteService };