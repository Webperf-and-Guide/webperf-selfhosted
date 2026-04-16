<script lang="ts">
  import Button from '@webperf/ui/components/ui/button';
  import type { RegionAvailability } from '@webperf/contracts';

  let {
    continent,
    regions,
    selectedRegions,
    toggleRegion
  } = $props<{
    continent: string;
    regions: RegionAvailability[];
    selectedRegions: string[];
    toggleRegion: (region: RegionAvailability) => void;
  }>();
</script>

<article class="continent-card">
  <header>
    <h3>{continent}</h3>
    <small>{regions.length} regions</small>
  </header>

  <div class="region-list">
    {#each regions as region (region.code)}
      <Button
        class={`region-tile ${selectedRegions.includes(region.code) ? 'selected' : ''}`}
        disabled={!region.selectable}
        variant="ghost"
        type="button"
        onclick={() => toggleRegion(region)}
      >
        <strong>{region.label}</strong>
        <span>{region.launchStage === 'core' ? 'launch active' : 'catalog only'}</span>
      </Button>
    {/each}
  </div>
</article>
