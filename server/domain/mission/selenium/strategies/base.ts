import type { SeleniumConfig, SeleniumStep } from "@shared/schema/index.js";
import type { VariableContext } from "@server/core/variable-resolver.js";

export interface PageLike {
    goto(url: string, options?: any): Promise<any>;
    click(selector: string, options?: any): Promise<void>;
    dblclick(selector: string, options?: any): Promise<void>;
    fill(selector: string, value: string, options?: any): Promise<void>;
    selectOption(selector: string, value: string, options?: any): Promise<any>;
    check(selector: string, options?: any): Promise<void>;
    uncheck(selector: string, options?: any): Promise<void>;
    hover(selector: string, options?: any): Promise<void>;
    waitForSelector(selector: string, options?: any): Promise<any>;
    waitForURL(url: string, options?: any): Promise<void>;
    waitForLoadState(state: string, options?: any): Promise<void>;
    textContent(selector: string): Promise<string | null>;
    innerHTML(selector: string): Promise<string>;
    getAttribute(selector: string, attribute: string): Promise<string | null>;
    locator(selector: string): any;
    evaluate(script: string | Function, arg?: any): Promise<any>;
    setInputFiles(selector: string, files: string | string[]): Promise<void>;
    keyboard: { press(key: string): Promise<void> };
    screenshot(options?: any): Promise<Buffer | string>;
    pdf(options?: any): Promise<Buffer>;
    context(): {
        cookies(): Promise<any[]>;
        addCookies(cookies: any[]): Promise<void>;
        close(): Promise<void>;
    };
    setDefaultTimeout(timeout: number): void;
    setDefaultNavigationTimeout(timeout: number): void;
    route(pattern: string, handler: (route: any) => void): Promise<void>;
    frameLocator(selector: string): any;
}

export interface BrowserStrategy {
    init(config: SeleniumConfig): Promise<{ page: PageLike; cleanup: () => Promise<void> }>;
}

export interface ExecutionContext {
    page: PageLike;
    config: SeleniumConfig;
    context: VariableContext;
    extracted: Record<string, any>;
    screenshots: Record<string, string>;
}


