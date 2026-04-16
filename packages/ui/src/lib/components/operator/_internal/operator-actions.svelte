<script lang="ts">
  import { Button } from '../../ui/button';
  import { CopyButton } from '../../ui/copy-button';
  import type { OperatorActionItem } from '../types';

  let {
    actions = [],
    class: className = ''
  } = $props<{
    actions?: OperatorActionItem[];
    class?: string;
  }>();
</script>

{#if actions.length > 0}
  <div class={`flex flex-wrap items-center gap-2 ${className}`.trim()}>
    {#each actions as action, index (action.id ?? `${action.kind ?? 'button'}:${action.label}:${index}`)}
      {#if action.kind === 'copy'}
        <CopyButton
          size={action.size ?? 'default'}
          text={action.text}
          variant={action.variant ?? 'ghost'}
        >
          {action.label}
        </CopyButton>
      {:else}
        <Button
          disabled={action.disabled}
          onclick={action.onclick}
          size={action.size ?? 'default'}
          type="button"
          variant={action.variant ?? 'ghost'}
        >
          {action.label}
        </Button>
      {/if}
    {/each}
  </div>
{/if}
