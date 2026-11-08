export type ReasonConfirmOptions = {
  summary?: string[];
  /** Exact text the operator must type, such as the product code. */
  typed?: string;
  typedLabel?: string;
};

export type ReasonConfirmRequest = ReasonConfirmOptions & {
  id: number;
  message: string;
  resolve: (reason: string | null) => void;
};

type Listener = (request: ReasonConfirmRequest | null) => void;

let seq = 0;
let active: ReasonConfirmRequest | null = null;
const pending: ReasonConfirmRequest[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  const current = active;
  for (const listener of listeners) listener(current);
}

export function subscribeReasonConfirm(listener: Listener): () => void {
  listeners.add(listener);
  listener(active);
  return () => {
    listeners.delete(listener);
  };
}

/** Resolves `null` when no host is mounted, or when the operator cancels. */
export function requestReasonConfirm(
  message: string,
  options?: ReasonConfirmOptions,
): Promise<string | null> {
  if (listeners.size === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request: ReasonConfirmRequest = {
      id: ++seq,
      message,
      ...options,
      resolve,
    };
    if (!active) {
      active = request;
      emit();
    } else {
      pending.push(request);
    }
  });
}

export function settleReasonConfirm(reason: string | null): void {
  if (!active) return;
  const current = active;
  active = pending.shift() ?? null;
  current.resolve(reason);
  emit();
}

export function resetReasonConfirmQueue(): void {
  const leftover: ReasonConfirmRequest[] = [];
  if (active) leftover.push(active);
  leftover.push(...pending);
  active = null;
  pending.length = 0;
  listeners.clear();
  for (const request of leftover) request.resolve(null);
}
