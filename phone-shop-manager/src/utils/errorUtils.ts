export const errorMessage = (err: unknown): string | undefined =>
  err !== null && typeof err === 'object' && 'message' in err
    ? String((err as { message: unknown }).message)
    : undefined;

export const errorCode = (err: unknown): string | undefined =>
  err !== null && typeof err === 'object' && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
