const tag = Bun.argv[2];
const target = Bun.argv[3] ?? 'all';

if (!tag) {
  throw new Error('Usage: bun tooling/scripts/bump-image-tag.ts <tag> [probe|browser-audit-worker|all]');
}

const metadataFiles = [
  {
    name: 'probe',
    path: new URL('../../infra/docker/metadata/probe.json', import.meta.url),
    image: `ghcr.io/your-org/webperf-probe:${tag}`
  },
  {
    name: 'browser-audit-worker',
    path: new URL('../../infra/docker/metadata/browser-audit-worker.json', import.meta.url),
    image: `ghcr.io/your-org/webperf-browser-audit-worker:${tag}`
  }
] as const;

const targets =
  target === 'all'
    ? metadataFiles
    : metadataFiles.filter((entry) => entry.name === target);

if (targets.length === 0) {
  throw new Error(`Unknown target: ${target}`);
}

for (const entry of targets) {
  const file = Bun.file(entry.path);
  const config = (await file.json()) as {
    image: string;
  } & Record<string, unknown>;

  const next = {
    ...config,
    image: entry.image
  };

  await Bun.write(entry.path, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`updated ${entry.name}`);
}
