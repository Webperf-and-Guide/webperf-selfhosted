export type SafeErrorDiagnostic = {
  errorType: string;
  causeType?: string;
  systemCode?: string;
};

export const describeSafeError = (error: unknown): SafeErrorDiagnostic => {
  const cause = error instanceof Error ? error.cause : undefined;
  const systemCode = readSafeSystemCode(error) ?? readSafeSystemCode(cause);

  return {
    errorType: error instanceof Error ? normalizeErrorName(error.name) : 'UnknownError',
    ...(cause instanceof Error ? { causeType: normalizeErrorName(cause.name) } : {}),
    ...(systemCode ? { systemCode } : {})
  };
};

const readSafeSystemCode = (value: unknown) => {
  const code = (value as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code)
    ? code
    : undefined;
};

const normalizeErrorName = (value: string) =>
  /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : 'UnknownError';
