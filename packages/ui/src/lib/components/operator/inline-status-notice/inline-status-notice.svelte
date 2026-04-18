<script lang="ts" module>
  import type { HTMLAttributes } from 'svelte/elements';

  export type InlineStatusTone = 'default' | 'success' | 'warning' | 'danger';
  export type InlineStatusNoticeProps = HTMLAttributes<HTMLParagraphElement> & {
    message: string;
    tone?: InlineStatusTone;
  };
</script>

<script lang="ts">
  import { cn } from '@webperf/ui/utils';

  let {
    message,
    tone = 'default',
    class: className = '',
    ...rest
  }: InlineStatusNoticeProps = $props();
</script>

<p {...rest} class={cn('status-notice', className)} data-tone={tone}>
  {message}
</p>
