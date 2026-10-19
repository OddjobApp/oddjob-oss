import { Page } from '@playwright/test';

export class BackgroundProcessManager {
  constructor(private page: Page) {}

  async waitForProcess(processId: string): Promise<string> {
    let status = 'running';
    while (status === 'running') {
      await this.page.waitForTimeout(1000);
      const response = await this.page.request.get(`/api/processes/${processId}/status`);
      status = (await response.json()).status;
    }
    return status;
  }
}