/**
 * The one error type the CLI catches and prints without a stack trace.
 *
 * Anything else escaping to the top level is a bug, and we want its stack.
 */
export class WondevError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'WondevError';
    this.hint = hint;
  }
}

export function isWondevError(err: unknown): err is WondevError {
  return err instanceof WondevError;
}
