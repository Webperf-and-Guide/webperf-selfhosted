<script lang="ts">
  import ConsoleWorkspace from '$lib/components/ConsoleWorkspace.svelte';
  import type { PageData } from './$types';

  let { data } = $props<{ data: PageData }>();
</script>

<ConsoleWorkspace {data} mode="overview" />
