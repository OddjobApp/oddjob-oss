declare module 'mermaid' {
  const mermaid: {
    initialize(config: Record<string, unknown>): void;
    mermaidAPI: {
      render(id: string, chart: string, callback: (svg: string) => void): void;
    };
  };

  export default mermaid;
}
