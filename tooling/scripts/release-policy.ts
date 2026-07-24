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
