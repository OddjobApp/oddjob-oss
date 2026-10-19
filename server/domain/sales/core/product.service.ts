import { db } from "@server/database_service.js";
import { products } from "@shared/schema/product.js";
import { eq } from "drizzle-orm";

class ProductService {
  async createProduct(name: string, description: string, options: any) {
    const [newProduct] = await db.insert(products).values({ name, description, options }).returning();
    return newProduct;
  }

  async updateProduct(id: number, name: string, description: string, options: any) {
    const [updatedProduct] = await db.update(products).set({ name, description, options }).where(eq(products.id, id)).returning();
    return updatedProduct;
  }

  async deleteProduct(id: number) {
    await db.delete(products).where(eq(products.id, id));
  }

  async getProductOptions(id: number) {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product.options;
  }
}

export { ProductService };