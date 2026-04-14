const tag = Bun.argv[2];

if (!tag) {
  throw new Error('Usage: bun tooling/scripts/bump-image-tag.ts <tag>');
}

const glob = new Bun.Glob('*.json');
const directory = new URL('../../infra/bunny/apps/', import.meta.url);

for await (const fileName of glob.scan(directory)) {
  const file = Bun.file(new URL(fileName, directory));
  const config = (await file.json()) as {
    image: string;
  } & Record<string, unknown>;

  const next = {
    ...config,
    image: `ghcr.io/your-org/webperf-probe:${tag}`
  };

  await Bun.write(new URL(fileName, directory), `${JSON.stringify(next, null, 2)}\n`);
  console.log(`updated ${fileName}`);
}
