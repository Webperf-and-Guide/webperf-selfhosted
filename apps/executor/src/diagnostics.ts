import { ExecutorApiError } from './client';

export type SafeErrorDiagnostic = {
  errorType: string;
  status?: number;
  incidentId?: string;
  serverCode?: string;
  causeType?: string;
  systemCode?: string;
};

export const describeSafeError = (error: unknown): SafeErrorDiagnostic => {
  const diagnosticSource = error instanceof ExecutorApiError ? error.cause : error;
  const systemCode = (diagnosticSource as { code?: unknown } | null)?.code;
  const safeSystemCode = typeof systemCode === 'string' && /^[A-Z0-9_]{1,64}$/.test(systemCode)
    ? systemCode
    : undefined;

  if (error instanceof ExecutorApiError) {
    return {
      errorType: normalizeErrorName(error.name),
      ...(error.status === null ? {} : { status: error.status }),
      ...(error.incidentId ? { incidentId: error.incidentId } : {}),
      ...(error.serverCode ? { serverCode: error.serverCode } : {}),
      ...(diagnosticSource instanceof Error
        ? { causeType: normalizeErrorName(diagnosticSource.name) }
        : {}),
      ...(safeSystemCode ? { systemCode: safeSystemCode } : {})
    };
  }

  return {
    errorType: error instanceof Error ? normalizeErrorName(error.name) : 'UnknownError',
    ...(safeSystemCode ? { systemCode: safeSystemCode } : {})
  };
};

export const normalizeErrorName = (value: string) =>
  /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : 'UnknownError';
