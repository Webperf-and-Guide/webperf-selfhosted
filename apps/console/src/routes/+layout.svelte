<script lang="ts">
  import '../app.css';
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import favicon from '$lib/assets/favicon.svg';
  import { appTitle } from '$lib/config';
  import { SegmentedNav, consoleShellLinks, themes } from '@webperf/ui';

  let { children } = $props<{ children: () => unknown }>();
  const queryClient = new QueryClient();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>{appTitle}</title>
</svelte:head>

<QueryClientProvider client={queryClient}>
  <div class="shell" data-theme={themes.operator}>
    <header class="topbar">
      <a class="brand" href="/">
        <span class="mark">WP</span>
        <span>
          <strong>{appTitle}</strong>
          <small>Self-host release verification operator console</small>
        </span>
      </a>

      <SegmentedNav class="nav" items={[...consoleShellLinks]} />
    </header>

    <main class="content">
      {@render children()}
    </main>
  </div>
</QueryClientProvider>
