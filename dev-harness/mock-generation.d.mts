export function mockGenerationEnabled(env?: NodeJS.ProcessEnv): boolean;

export function requestedMockGenerationCase(
  request: { url?: string; headers?: Record<string, string | string[] | undefined> },
  env?: NodeJS.ProcessEnv,
): string;

export function loadMockGeneration(name?: string): Promise<any>;

export function handleMockGeneration(
  request: { url?: string; headers?: Record<string, string | string[] | undefined> },
  response: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void },
  env?: NodeJS.ProcessEnv,
): Promise<void>;
