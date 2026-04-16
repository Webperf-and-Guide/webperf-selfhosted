<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';
  import type { MetricGridItem, OperatorTone } from '../types';

  export type RunStatusPanelProps = HTMLAttributes<HTMLDivElement> & {
    title: string;
    status: string;
    subtitle?: string;
    statusTone?: OperatorTone;
    summary: MetricGridItem[];
    details?: MetricGridItem[];
    errorMessage?: string | null;
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';
  import { Badge } from '@webperf/ui/components/ui/badge';
  import { Card } from '@webperf/ui/components/ui/card';
  import { MetricGrid } from '../metric-grid';
  import { badgeTone } from '../_internal/operator-tone';

  let {
    title,
    status,
    subtitle,
    statusTone = 'muted',
    summary = [],
    details = [],
    errorMessage = null,
    class: className = '',
    ...rest
  }: RunStatusPanelProps = $props();
</script>

<Card {...rest} class={cn('grid gap-4', className)}>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="grid gap-1">
      <strong class="text-base text-text">{title}</strong>
      {#if subtitle}
        <small class="text-sm leading-5 text-muted">{subtitle}</small>
      {/if}
    </div>
    <Badge tone={badgeTone(statusTone)}>{status}</Badge>
  </div>

  <MetricGrid columns={2} compact items={summary} />

  {#if details.length > 0}
    <MetricGrid columns="auto" compact itemClass="min-h-[5rem]" items={details} />
  {/if}

  {#if errorMessage}
    <p class="text-sm leading-6 text-danger">{errorMessage}</p>
  {/if}
</Card>
