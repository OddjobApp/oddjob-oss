
declare module "langchain/vectorstores/qdrant" {
  export class QdrantVectorStore {
    constructor(...args: any[]);
    static fromExistingCollection(...args: any[]): Promise<QdrantVectorStore>;
    addDocuments(...args: any[]): Promise<void>;
    delete(...args: any[]): Promise<void>;
    asRetriever(...args: any[]): { getRelevantDocuments: (...args: any[]) => Promise<any[]> };
  }
}

declare module "langchain/text_splitter" {
  export class RecursiveCharacterTextSplitter {
    constructor(config?: { chunkSize?: number; chunkOverlap?: number });
    splitText(text: string): Promise<string[]>;
  }
}

declare module "cors" {
  import type { RequestHandler } from "express";
  interface CorsOptions {
    origin?: boolean | string | RegExp | Array<string | RegExp> | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void);
    methods?: string | string[];
    allowedHeaders?: string | string[];
    exposedHeaders?: string | string[];
    credentials?: boolean;
    maxAge?: number;
    preflightContinue?: boolean;
    optionsSuccessStatus?: number;
  }

  function cors(options?: CorsOptions): RequestHandler;
  export = cors;
}

declare global {
  namespace Express {
    interface Request {
      organizationId?: number;
      correlationId?: string;
    }
  }
}

export { };

