export const extractWorkflowActionReferences = (content: string) =>
  [...content.matchAll(
    /^\s*(?:-\s*)?uses:\s+(?:"([^"]+)"|'([^']+)'|([^\s#]+))(?:\s+#.*)?$/gm
  )].map((match) => match[1] ?? match[2] ?? match[3] ?? '');

export const isImmutableActionReference = (action: string) => {
  if (action.startsWith('./')) {
    return true;
  }

  if (action.startsWith('docker://')) {
    return /@sha256:[a-f0-9]{64}$/.test(action);
  }

  const separator = action.lastIndexOf('@');
  const reference = separator === -1 ? '' : action.slice(separator + 1);
  return /^[a-f0-9]{40}$/.test(reference);
};

export const containsMutableContainerTag = (content: string) =>
  /(?:^|[\s"'=])(?:[a-z0-9.-]+(?::\d+)?\/)?[a-z0-9._/-]+:(?:main|latest)(?=$|[\s"',}\]])/im
    .test(content);

export type WorkflowPolicyDocument = {
  concurrency?: {
    group?: unknown;
    'cancel-in-progress'?: unknown;
  };
  jobs?: Record<string, {
    permissions?: unknown;
    strategy?: {
      matrix?: {
        include?: unknown;
      };
    };
  }>;
};

export type WorkflowYamlParseResult =
  | { ok: true; document: WorkflowPolicyDocument }
  | { ok: false; reason: 'invalid_yaml' | 'invalid_mapping' };

const normalizedWorkflowExpression = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : undefined;

export function hasCollisionSafeCiConcurrency(
  document: WorkflowPolicyDocument
): boolean {
  const group = normalizedWorkflowExpression(document.concurrency?.group);
  if (group === undefined) {
    return false;
  }

  return /^ci-\$\{\{\s*inputs\.source_sha\s*!=\s*(['"])\1\s*&&\s*format\(\s*(['"])release-\{0\}\2\s*,\s*inputs\.source_sha\s*\)\s*\|\|\s*github\.event\.pull_request\.number\s*\|\|\s*github\.ref\s*\}\}$/.test(group);
}

export function cancelsOnlySupersededPullRequestCi(
  document: WorkflowPolicyDocument
): boolean {
  const cancelInProgress = normalizedWorkflowExpression(
    document.concurrency?.['cancel-in-progress']
  );
  return /^\$\{\{\s*github\.event_name\s*==\s*(['"])pull_request\1\s*\}\}$/.test(
    cancelInProgress ?? ''
  );
}

export function parseWorkflowYaml(content: string): WorkflowYamlParseResult {
  let document: unknown;
  try {
    document = Bun.YAML.parse(content);
  } catch {
    return { ok: false, reason: 'invalid_yaml' };
  }

  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return { ok: false, reason: 'invalid_mapping' };
  }

  return { ok: true, document: document as WorkflowPolicyDocument };
}

export const workflowJobPermissions = (
  document: WorkflowPolicyDocument,
  jobId: string
): unknown => document.jobs?.[jobId]?.permissions;

export function hasExactPermissions(
  permissions: unknown,
  expected: Record<string, 'read' | 'write' | 'none'>
): boolean {
  if (
    permissions === null
    || typeof permissions !== 'object'
    || Array.isArray(permissions)
  ) {
    return false;
  }

  const entries = Object.entries(permissions);
  const expectedNames = Object.keys(expected);
  return (
    entries.length === expectedNames.length
    && entries.every(([name, access]) => expected[name] === access)
  );
}
