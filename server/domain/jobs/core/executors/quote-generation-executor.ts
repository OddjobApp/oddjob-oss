import { Job, JobExecutor, StepExecutionResult, VariableContext } from "./executor-types.js";
import { ProductService } from "@server/domain/sales/core/product.service.js";
import { QuoteService } from "@server/domain/sales/core/quote.service.js";

export class QuoteGenerationExecutor implements JobExecutor {
  canExecute(jobType: string): boolean {
    return jobType === "create_quote";
  }

  async execute(
    job: Job,
    resolvedConfig: any,
    pipeline: any,
    context: VariableContext
  ): Promise<StepExecutionResult> {
    const orgId = job.organizationId;
    if (!orgId) {
      return { success: false, output: "", status: "failure", error: "create_quote requires an organizationId" };
    }

    const { opportunity } = resolvedConfig;
    const productService = new ProductService();
    const quoteService = new QuoteService();

    // This is a simplified example. In a real application, you would have more complex logic
    // for selecting products and configuring them.
    const productOptions = await productService.getProductOptions(opportunity.productId);
    const lineItems: any[] = [/* ...build line items based on productOptions... */];
    const quoteNumber = `Q-${Date.now()}`;

    const newQuote = await quoteService.createQuote(quoteNumber, opportunity.id, lineItems);

    return { success: true, output: JSON.stringify({ quoteId: newQuote.id }), status: "success" };
  }
}