/** How long any test waits for a condition. */
export const WAIT_TIMEOUT_MS = 15000;

/**
 * Polls `read` every 50 ms until `accept` holds for its value and returns that
 * value. Rejects after `WAIT_TIMEOUT_MS` with `label` in the message.
 */
export async function waitFor<T>(
  read: () => T | PromiseLike<T>,
  accept: (value: T) => boolean,
  label = 'the expected condition'
): Promise<T> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  do {
    const value = await read();
    if (accept(value)) {
      return value;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}.`);
}

/** Rejects when `promise` does not settle within `WAIT_TIMEOUT_MS`. */
export async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), WAIT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** A promise with its `resolve` exposed, for tests that release work by hand. */
export interface Deferred<T = void> {
  promise: Promise<T>;
  resolve(value: T): void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
