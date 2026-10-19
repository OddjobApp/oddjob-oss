import { db } from "@server/database_service.js";
import { territories } from "@shared/schema/territory.js";
import { products } from "@shared/schema/product.js";
import { quotes } from "@shared/schema/quote.js";

export async function createTerritory(name: string, description: string, rules: any) {
  const [newTerritory] = await db.insert(territories).values({ name, description, rules }).returning();
  return newTerritory;
}

export async function createProduct(name: string, description: string, options: any) {
  const [newProduct] = await db.insert(products).values({ name, description, options }).returning();
  return newProduct;
}

export async function createQuote(quoteNumber: string, opportunityId: number, lineItems: any) {
  const [newQuote] = await db.insert(quotes).values({ quoteNumber, opportunityId, lineItems }).returning();
  return newQuote;
}