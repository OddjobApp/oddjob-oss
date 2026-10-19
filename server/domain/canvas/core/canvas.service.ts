import { UiGenerationService } from '../services/ui-generation.service.js';

export class CanvasService {
  /**
   * The main entry point for the Canvas domain.
   * Orchestrates the generation of a UI for a given application specification.
   *
   * @param appName The name of the application.
   * @param openApiSpec The OpenAPI specification for the application's backend.
   * @param organizationId The ID of the organization invoking the service.
   * @returns The generated React UI code as a string.
   */
  static async generateAppCanvas(
    appName: string,
    openApiSpec: Record<string, any>,
    themeColor: string,
    organizationId: number
  ): Promise<{ app_tsx: string; theme_css: string }> {
    console.log(`Starting UI generation for application: ${appName} with theme ${themeColor}`);

    const generatedUi = await UiGenerationService.generateUiFromSpec(openApiSpec, themeColor, organizationId);

    // In the future, this service will also handle file writing, etc.

    console.log(`Successfully generated UI for ${appName}.`);

    return generatedUi;
  }
}
