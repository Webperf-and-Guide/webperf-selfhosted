<script lang="ts">
  import { OperatorEmptyState } from '@webperf/ui/components/operator/operator-empty-state';

  let {
    title = 'No saved checks yet.',
    detail = 'Create a site, route group, region set, and saved check above, then run it manually or through the scheduler endpoint.'
  } = $props<{
    title?: string;
    detail?: string;
  }>();
</script>

<OperatorEmptyState
  {detail}
  {title}
/>
