<script lang="ts">
  import type { BrowserAuditResource } from '@webperf/contracts';
  import { InlineStatusNotice } from '@webperf/ui/components/operator/inline-status-notice';
  import { MetricGrid } from '@webperf/ui/components/operator/metric-grid';
  import { OperatorEmptyState } from '@webperf/ui/components/operator/operator-empty-state';
  import { Badge } from '@webperf/ui/components/ui/badge';
  import Button from '@webperf/ui/components/ui/button';
  import { Card } from '@webperf/ui/components/ui/card';
  import { CopyButton } from '@webperf/ui/components/ui/copy-button';
  import { ScrollArea } from '@webperf/ui/components/ui/scroll-area';
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
  } from '@webperf/ui/components/ui/table';

  let {
    audits,
    selectedAuditId = null,
    onSelect,
    formatDateTime,
    formatPercentScore,
    formatText,
    formatTiming
  } = $props<{
    audits: BrowserAuditResource[];
    selectedAuditId?: string | null;
    onSelect: (auditId: string) => void;
    formatDateTime: (value: string | null | undefined) => string;
    formatPercentScore: (value: number | null | undefined) => string;
    formatText: (value: string | null | undefined) => string;
    formatTiming: (value: number | null | undefined) => string;
  }>();

  const selectedAudit = $derived.by(
    () => audits.find((audit: BrowserAuditResource) => audit.id === selectedAuditId) ?? audits[0] ?? null
  );

  const toneForStatus = (status: BrowserAuditResource['status']) => {
    switch (status) {
      case 'succeeded':
        return 'success';
      case 'failed':
      case 'cancelled':
        return 'danger';
      default:
        return 'accent';
    }
  };

  const summaryRows = $derived.by(() =>
    selectedAudit
      ? [
          { label: 'Audit id', value: selectedAudit.id },
          { label: 'Target URL', value: selectedAudit.targetUrl },
          { label: 'Region', value: formatText(selectedAudit.region) },
          { label: 'Preset', value: selectedAudit.policy.preset },
          { label: 'Requested', value: formatDateTime(selectedAudit.requestedAt) },
          { label: 'Completed', value: formatDateTime(selectedAudit.completedAt) }
        ]
      : []
  );

  const metricRows = $derived.by(() =>
    selectedAudit?.result
      ? [
          { label: 'Performance', value: formatPercentScore(selectedAudit.result.summary.performanceScore) },
          { label: 'Accessibility', value: formatPercentScore(selectedAudit.result.summary.accessibilityScore) },
          { label: 'Best practices', value: formatPercentScore(selectedAudit.result.summary.bestPracticesScore) },
          { label: 'SEO', value: formatPercentScore(selectedAudit.result.summary.seoScore) },
          { label: 'FCP', value: formatTiming(selectedAudit.result.summary.fcpMs) },
          { label: 'LCP', value: formatTiming(selectedAudit.result.summary.lcpMs) },
          { label: 'CLS', value: formatText(selectedAudit.result.summary.cls?.toString()) },
          { label: 'INP', value: formatTiming(selectedAudit.result.summary.inpMs) },
          { label: 'TBT', value: formatTiming(selectedAudit.result.summary.tbtMs) },
          { label: 'Speed index', value: formatTiming(selectedAudit.result.summary.speedIndexMs) }
        ]
      : []
  );

  const auditSummaryItems = $derived.by(() =>
    selectedAudit
      ? [
          { id: 'status', label: 'Status', value: selectedAudit.status },
          { id: 'steps', label: 'Flow steps', value: selectedAudit.policy.flow.steps.length },
          { id: 'headers', label: 'Custom headers', value: selectedAudit.customHeaders.length },
          { id: 'cookies', label: 'Cookies', value: selectedAudit.cookies.length },
          { id: 'artifacts', label: 'Artifacts', value: selectedAudit.result?.artifacts.length ?? 0 },
          { id: 'issues', label: 'Issues', value: selectedAudit.result?.issues.length ?? 0 }
        ]
      : []
  );

  const policyRows = $derived.by(() =>
    selectedAudit
      ? [
          { label: 'Provider class', value: selectedAudit.policy.providerClass },
          { label: 'Required', value: selectedAudit.policy.required ? 'yes' : 'no' },
          {
            label: 'Artifacts',
            value: Object.entries(selectedAudit.policy.artifacts)
              .filter(([, enabled]) => enabled)
              .map(([kind]) => kind)
              .join(', ') || 'none'
          },
          {
            label: 'Timeouts',
            value: `${selectedAudit.policy.timeouts.totalTimeoutMs}ms total / ${selectedAudit.policy.timeouts.stepTimeoutMs}ms step`
          }
        ]
      : []
  );

  const toolchainRows = $derived.by(() =>
    selectedAudit?.result
      ? [
          { label: 'Bun', value: selectedAudit.result.toolchain.bunVersion },
          { label: 'Chrome', value: selectedAudit.result.toolchain.chromeVersion },
          { label: 'Puppeteer', value: selectedAudit.result.toolchain.puppeteerVersion },
          { label: 'Lighthouse', value: selectedAudit.result.toolchain.lighthouseVersion }
        ]
      : []
  );

  const formatByteSize = (value: number | null | undefined) => {
    if (value == null) {
      return 'n/a';
    }

    if (value < 1024) {
      return `${value} B`;
    }

    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    }

    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  };
</script>

{#if audits.length === 0}
  <OperatorEmptyState
    detail="Start a direct-run browser audit to persist the summary, artifact metadata, and failure reason here."
    title="No browser audits yet."
  />
{:else}
  <div class="grid gap-4 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
    <Card class="border-line/55 bg-white/[0.025] p-3">
      <div class="flex items-center justify-between gap-2">
        <div>
          <p class="text-[0.72rem] uppercase tracking-[0.18em] text-muted">Recent runs</p>
          <p class="text-sm text-muted">Select a run to inspect the latest saved payload.</p>
        </div>
        <Badge tone="accent">{audits.length} saved</Badge>
      </div>

      <ScrollArea class="mt-3 max-h-[28rem] pr-2">
        <div class="space-y-2">
          {#each audits as audit (audit.id)}
            <Button
              class="h-auto w-full items-start justify-between gap-3 rounded-[var(--wp-radius-md)] border border-line/55 bg-white/[0.02] px-3 py-3 text-left"
              onclick={() => onSelect(audit.id)}
              variant={audit.id === selectedAudit?.id ? 'secondary' : 'ghost'}
            >
              <div class="min-w-0 space-y-1">
                <p class="truncate text-sm font-medium text-text">{audit.targetUrl}</p>
                <p class="text-xs text-muted">
                  {formatText(audit.region)} · {formatDateTime(audit.completedAt ?? audit.requestedAt)}
                </p>
                <p class="text-xs text-muted">
                  {audit.policy.preset} · Perf {formatPercentScore(audit.result?.summary.performanceScore)}
                </p>
              </div>
              <Badge tone={toneForStatus(audit.status)}>{audit.status}</Badge>
            </Button>
          {/each}
        </div>
      </ScrollArea>
    </Card>

    {#if selectedAudit}
      <div class="space-y-4">
        <Card class="border-line/55 bg-white/[0.025] p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="space-y-1">
              <p class="text-[0.72rem] uppercase tracking-[0.18em] text-muted">Audit detail</p>
              <h3 class="text-lg font-semibold text-text">{selectedAudit.targetUrl}</h3>
              <p class="text-sm text-muted">
                Preset {selectedAudit.policy.preset} · region {formatText(selectedAudit.region)}
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <Badge tone={toneForStatus(selectedAudit.status)}>{selectedAudit.status}</Badge>
              <CopyButton text={selectedAudit.id}>Copy id</CopyButton>
            </div>
          </div>

          {#if selectedAudit.error}
            <div class="mt-4">
              <InlineStatusNotice message={selectedAudit.error} tone="danger" />
            </div>
          {/if}

          <div class="mt-4">
            <MetricGrid compact columns={3} items={auditSummaryItems} />
          </div>

          <div class="mt-4 grid gap-4 lg:grid-cols-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {#each summaryRows as row (row.label)}
                  <TableRow>
                    <TableCell>{row.label}</TableCell>
                    <TableCell>{row.value}</TableCell>
                  </TableRow>
                {/each}
              </TableBody>
            </Table>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Policy</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {#each policyRows as row (row.label)}
                  <TableRow>
                    <TableCell>{row.label}</TableCell>
                    <TableCell>{row.value}</TableCell>
                  </TableRow>
                {/each}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card class="border-line/55 bg-white/[0.025] p-4">
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="text-[0.72rem] uppercase tracking-[0.18em] text-muted">Metric summary</p>
              <p class="text-sm text-muted">Direct-run audits keep the high-signal Lighthouse summary front and center.</p>
            </div>
            <Badge tone="muted">{selectedAudit.policy.preset}</Badge>
          </div>

          <Table class="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#if metricRows.length > 0}
                {#each metricRows as row (row.label)}
                  <TableRow>
                    <TableCell>{row.label}</TableCell>
                    <TableCell>{row.value}</TableCell>
                    </TableRow>
                  {/each}
                {:else}
                  <TableRow>
                    <TableCell colspan={2}>No metric summary was recorded for this run.</TableCell>
                  </TableRow>
              {/if}
            </TableBody>
          </Table>
        </Card>

        <Card class="border-line/55 bg-white/[0.025] p-4">
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="text-[0.72rem] uppercase tracking-[0.18em] text-muted">Artifacts</p>
              <p class="text-sm text-muted">Binary download stays runtime-specific, but the metadata and pointers are persisted here.</p>
            </div>
            <Badge tone="muted">{selectedAudit.result?.artifacts.length ?? 0} refs</Badge>
          </div>

          <Table class="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Content type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Created</TableHead>
                <TableHead class="text-right">Pointer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#if (selectedAudit.result?.artifacts.length ?? 0) > 0}
                {#each selectedAudit.result?.artifacts ?? [] as artifact (artifact.id)}
                  <TableRow>
                    <TableCell>{artifact.kind}</TableCell>
                    <TableCell>{artifact.contentType}</TableCell>
                    <TableCell>{formatByteSize(artifact.byteSize)}</TableCell>
                    <TableCell>{formatDateTime(artifact.createdAt)}</TableCell>
                    <TableCell class="text-right">
                      <CopyButton text={artifact.url}>Copy pointer</CopyButton>
                    </TableCell>
                  </TableRow>
                {/each}
              {:else}
                <TableRow>
                  <TableCell colspan={5}>No artifact metadata was recorded for this run.</TableCell>
                </TableRow>
              {/if}
            </TableBody>
          </Table>
        </Card>

        <Card class="border-line/55 bg-white/[0.025] p-4">
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="text-[0.72rem] uppercase tracking-[0.18em] text-muted">Toolchain</p>
              <p class="text-sm text-muted">Keep the worker runtime visible so direct-run results stay reproducible.</p>
            </div>
            <Badge tone="muted">{selectedAudit.result ? 'captured' : 'not recorded'}</Badge>
          </div>

          <Table class="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>Version</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#if toolchainRows.length > 0}
                {#each toolchainRows as row (row.label)}
                  <TableRow>
                    <TableCell>{row.label}</TableCell>
                    <TableCell>{row.value}</TableCell>
                  </TableRow>
                {/each}
              {:else}
                <TableRow>
                  <TableCell colspan={2}>Toolchain data was not recorded for this run.</TableCell>
                </TableRow>
              {/if}
            </TableBody>
          </Table>
        </Card>
      </div>
    {/if}
  </div>
{/if}
