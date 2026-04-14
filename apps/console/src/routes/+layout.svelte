<script lang="ts">
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import favicon from '$lib/assets/favicon.svg';
  import { appTitle } from '$lib/config';
  import { brandPalette, shellLinks } from '@webperf/ui';

  let { children } = $props<{ children: () => unknown }>();
  const queryClient = new QueryClient();

  const paletteStyle = [
    `--canvas:${brandPalette.canvas}`,
    `--surface:${brandPalette.surface}`,
    `--surface-strong:${brandPalette.surfaceStrong}`,
    `--accent:${brandPalette.accent}`,
    `--accent-soft:${brandPalette.accentSoft}`,
    `--text:${brandPalette.text}`,
    `--muted:${brandPalette.muted}`,
    `--line:${brandPalette.line}`
  ].join(';');
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>{appTitle}</title>
</svelte:head>

<QueryClientProvider client={queryClient}>
  <div class="shell" style={paletteStyle}>
    <header class="topbar">
      <a class="brand" href="/">
        <span class="mark">WP</span>
        <span>
          <strong>{appTitle}</strong>
          <small>Self-host release verification operator console</small>
        </span>
      </a>

      <nav class="nav">
        {#each shellLinks as link (link.href)}
          <a href={link.href}>{link.label}</a>
        {/each}
      </nav>
    </header>

    <main class="content">
      {@render children()}
    </main>
  </div>
</QueryClientProvider>

<style>
  :global(body) {
    margin: 0;
    min-height: 100vh;
    color: var(--text);
    font-family:
      "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
    background:
      radial-gradient(circle at top left, rgba(255, 120, 79, 0.22), transparent 30%),
      radial-gradient(circle at top right, rgba(63, 148, 217, 0.16), transparent 24%),
      linear-gradient(180deg, #09131d 0%, var(--canvas) 100%);
  }

  :global(a) {
    color: inherit;
    text-decoration: none;
  }

  .shell {
    min-height: 100vh;
    padding: 20px;
  }

  .topbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: center;
    width: min(1180px, 100%);
    margin: 0 auto;
    padding: 18px 22px;
    border: 1px solid var(--line);
    border-radius: 24px;
    background: var(--surface);
    backdrop-filter: blur(18px);
  }

  .brand {
    display: flex;
    gap: 14px;
    align-items: center;
  }

  .mark {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 14px;
    background: linear-gradient(135deg, #ff784f 0%, #ffb05f 100%);
    color: #101820;
    font-weight: 800;
    letter-spacing: 0.08em;
  }

  .brand strong {
    display: block;
    font-size: 1rem;
  }

  .brand small {
    color: var(--muted);
  }

  .nav {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .nav a {
    padding: 10px 12px;
    border-radius: 999px;
    color: var(--accent-soft);
  }

  .nav a:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .content {
    width: min(1180px, 100%);
    margin: 24px auto 0;
  }

  @media (max-width: 860px) {
    .topbar {
      grid-template-columns: 1fr;
    }

    .nav {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      justify-content: stretch;
    }

    .nav a {
      text-align: center;
      border: 1px solid rgba(173, 192, 207, 0.12);
    }
  }
</style>
