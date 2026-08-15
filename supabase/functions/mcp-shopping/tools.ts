// Stub — replaced in Task 4 with real tool schemas and handlers.
export const TOOLS: unknown[] = [];
export async function callTool(_db: unknown, _claims: unknown, _params: Record<string, unknown>) {
  return { content: [{ type: 'text', text: 'not implemented' }], isError: true };
}
