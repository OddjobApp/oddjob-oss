import { Page } from '@playwright/test';

export class ApiSpy {
  private requests: any[] = [];

  constructor(page: Page, urlPattern: string) {
    page.on('request', request => {
      if (request.url().includes(urlPattern)) {
        this.requests.push(request);
      }
    });
  }

  getRequests() {
    return this.requests;
  }

  clear() {
    this.requests = [];
  }
}