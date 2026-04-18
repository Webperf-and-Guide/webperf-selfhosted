<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';
  import type { MetricGridItem, OperatorTone } from '../types';

  export type LiveRunTargetCardProps = HTMLAttributes<HTMLDivElement> & {
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
  import { RunStatusPanel } from '../run-status-panel';

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
  }: LiveRunTargetCardProps = $props();
</script>

<RunStatusPanel
  {...rest}
  class={cn('result-card', className)}
  {details}
  {errorMessage}
  {status}
  {statusTone}
  {subtitle}
  {summary}
  {title}
/>
