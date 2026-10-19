export interface MockExecutorContext {
  job: any;
  pipeline: any;
  variables: any;
  traceContext: any;
  data: Record<string, any>;
}

export class MockExecutorContextBuilder {
  private context: Partial<MockExecutorContext> = {};
  
  withJob(job: any): this {
    this.context.job = {
      id: 1,
      name: 'Test Job',
      type: 'api',
      config: {},
      organizationId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...job,
    };
    return this;
  }
  
  withPipeline(pipeline: any): this {
    this.context.pipeline = {
      id: 1,
      name: 'Test Pipeline',
      organizationId: 1,
      ...pipeline,
    };
    return this;
  }
  
  withVariables(variables: Record<string, any>): this {
    this.context.variables = variables as any;
    return this;
  }
  
  withTraceContext(): this {
    this.context.traceContext = {
      traceId: 'test-trace-123',
      spanId: 'test-span-456',
      parentSpanId: null,
    };
    return this;
  }
  
  withData(data: Record<string, any>): this {
    this.context.data = data;
    return this;
  }
  
  build(): MockExecutorContext {
    return {
      job: this.context.job || this.createDefaultJob(),
      pipeline: this.context.pipeline || this.createDefaultPipeline(),
      variables: this.context.variables || ({} as any),
      traceContext: this.context.traceContext || this.createDefaultTrace(),
      data: this.context.data || {},
    };
  }
  
  private createDefaultJob(): any {
    return {
      id: 1,
      name: 'Test Job',
      type: 'api',
      config: {},
      organizationId: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
  
  private createDefaultPipeline(): any {
    return {
      id: 1,
      name: 'Test Pipeline',
      organizationId: 1,
    };
  }
  
  private createDefaultTrace(): any {
    return {
      traceId: 'test-trace-123',
      spanId: 'test-span-456',
      parentSpanId: null,
    };
  }
}
