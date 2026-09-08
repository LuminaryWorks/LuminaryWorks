export type ConfirmFn = (message: string) => boolean;
export type PromptFn = (message: string) => string | null;

export async function confirmDestructive(
  message: string,
  options?: { typed?: string; confirm?: ConfirmFn; prompt?: PromptFn },
): Promise<boolean> {
  const typed = options?.typed;
  if (typed) {
    const prompt = options?.prompt ?? ((msg: string) => globalThis.prompt(msg));
    const value = prompt(`${message}\n\nType ${typed} to continue.`);
    return value === typed;
  }
  const confirm =
    options?.confirm ?? ((msg: string) => globalThis.confirm(msg));
  return confirm(message);
}
