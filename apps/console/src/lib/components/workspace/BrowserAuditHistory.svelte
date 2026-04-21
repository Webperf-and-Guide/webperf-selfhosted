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

  const requestContextRows = $derived.by(() =>
    selectedAudit
      ? [
          {
            label: 'Headers',
            value:
              selectedAudit.customHeaders.length > 0
                ? selectedAudit.customHeaders.map((header: BrowserAuditResource['customHeaders'][number]) => header.name).join(', ')
                : 'none'
          },
          {
            label: 'Cookies',
            value:
              selectedAudit.cookies.length > 0
                ? selectedAudit.cookies.map((cookie: BrowserAuditResource['cookies'][number]) => cookie.name).join(', ')
                : 'none'
          },
          {
            label: 'Flow',
            value: selectedAudit.policy.flow.steps
              .map((step: BrowserAuditResource['policy']['flow']['steps'][number]) => step.type)
              .join(' -> ')
          }
        ]
      : []
  );

  const headerRows = $derived.by(() => selectedAudit?.customHeaders ?? []);

  const cookieRows = $derived.by(() => selectedAudit?.cookies ?? []);

  const flowRows = $derived.by(() =>
    selectedAudit
      ? selectedAudit.policy.flow.steps.map((step: BrowserAuditResource['policy']['flow']['steps'][number], index: number) => ({
          id: `${index + 1}-${step.type}`,
          step: index + 1,
          type: step.type,
          detail: describeFlowStep(step)
        }))
      : []
  );

  const checkpointRows = $derived.by(() =>
    selectedAudit?.result?.checkpoints.map((checkpoint: NonNullable<BrowserAuditResource['result']>['checkpoints'][number]) => ({
      id: checkpoint.id,
      mode: checkpoint.mode,
      label: checkpoint.label ?? 'Untitled checkpoint',
      performance: formatPercentScore(checkpoint.summary.performanceScore),
      lcp: formatTiming(checkpoint.summary.lcpMs)
    })) ?? []
  );

  const issueRows = $derived.by(() => selectedAudit?.result?.issues ?? []);

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

  const pluralize = (value: number, label: string) => `${value} ${label}${value === 1 ? '' : 's'}`;

  const summarizeRecentAudit = (audit: BrowserAuditResource) => {
    if (audit.error) {
      return audit.error;
    }

    const checkpointCount = audit.result?.checkpoints.length ?? 0;
    const artifactCount = audit.result?.artifacts.length ?? 0;
    const issueCount = audit.result?.issues.length ?? 0;

    if (audit.status === 'failed' || issueCount > 0) {
      return `${pluralize(issueCount, 'issue')} · ${pluralize(artifactCount, 'artifact')}`;
    }

    return `${pluralize(checkpointCount, 'checkpoint')} · ${pluralize(artifactCount, 'artifact')}`;
  };

  const formatPointerLabel = (value: string) => {
    try {
      const parsed = new URL(value);
      const path = parsed.pathname === '/' ? '' : parsed.pathname;
      return `${parsed.hostname}${path}`;
    } catch {
      return value.length > 64 ? `${value.slice(0, 64)}...` : value;
    }
  };

  const describeFlowStep = (step: BrowserAuditResource['policy']['flow']['steps'][number]) => {
    switch (step.type) {
      case 'navigate':
        return step.url ?? 'target URL';
      case 'waitForSelector':
        return `${step.selector} (${step.state ?? 'visible'})`;
      case 'waitForUrl':
        return `${step.match} ${step.url}`;
      case 'click':
        return step.selector;
      case 'type':
        return `${step.selector} (${pluralize(step.text.length, 'char')}${step.clear ? ', clears first' : ''})`;
      case 'press':
        return step.key;
      case 'select':
        return `${step.selector} -> ${step.values.join(', ')}`;
      case 'waitForTimeout':
        return `${step.ms}ms`;
      case 'setViewport':
        return `${step.width}x${step.height}${step.isMobile ? ' mobile' : ''}`;
      case 'setCookie':
        return step.cookie.domain ?? step.cookie.url ?? step.cookie.name;
      case 'setExtraHeaders':
        return step.headers.map((header) => header.name).join(', ');
      case 'snapshot':
        return step.label ?? 'snapshot';
      case 'timespanStart':
        return step.label ?? 'timespan start';
      case 'timespanEnd':
        return step.label ?? 'timespan end';
    }
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
                <p class={audit.error ? 'truncate text-[0.72rem] text-danger/85' : 'truncate text-[0.72rem] text-muted'}>
                  {summarizeRecentAudit(audit)}
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

        {#if selectedAudit.error}
          <Card class="border-line/55 bg-white/[0.025] p-4">
            <div class="flex items-center justify-between gap-2">
              <div>
                <p class="text-[0.72rem] uppercase tracking-[0.18em] text-muted">Failure summary</p>
                <p class="text-sm text-muted">Keep the operator-visible failure reason separate from structured worker issues.</p>
              </div>
              <Badge tone="danger">{selectedAudit.status}</Badge>
            </div>

            <div class="mt-4">
              <InlineStatusNotice message={selectedAudit.error} tone="danger" />
            </div>
          </Card>
        {/if}

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
              <p class="text-[0.72rem] uppercase tracking-[0.18em] text-muted">Checkpoints</p>
              <p class="text-sm text-muted">Checkpoint summaries show where the worker captured navigation, snapshot, and timespan evidence.</p>
            </div>
            <Badge tone="muted">{checkpointRows.length}</Badge>
          </div>

          <Table class="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Performance</TableHead>
                <TableHead>LCP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#if checkpointRows.length > 0}
                {#each checkpointRows as checkpoint (checkpoint.id)}
                  <TableRow>
                    <TableCell>{checkpoint.label}</TableCell>
                    <TableCell>{checkpoint.mode}</TableCell>
                    <TableCell>{checkpoint.performance}</TableCell>
                    <TableCell>{checkpoint.lcp}</TableCell>
                  </TableRow>
                {/each}
              {:else}
                <TableRow>
                  <TableCell colspan={4}>No checkpoints were recorded for this run.</TableCell>
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
                    <TableCell>
                      <div class="flex items-center justify-end gap-2">
                        <span class="max-w-[16rem] truncate text-xs text-muted">{formatPointerLabel(artifact.url)}</span>
                        <CopyButton text={artifact.url}>Copy pointer</CopyButton>
                      </div>
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

        <Card class="border-line/55 bg-white/[0.025] p-4">
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="text-[0.72rem] uppercase tracking-[0.18em] text-muted">Request context</p>
              <p class="text-sm text-muted">Direct-run headers, cookies, and flow shape stay visible for debugging and reruns.</p>
            </div>
            <Badge tone="muted">{requestContextRows.length} rows</Badge>
          </div>

          <Table class="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Context</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each requestContextRows as row (row.label)}
                <TableRow>
                  <TableCell>{row.label}</TableCell>
                  <TableCell>{row.value}</TableCell>
                </TableRow>
              {/each}
            </TableBody>
          </Table>

          <div class="mt-4 grid gap-4 xl:grid-cols-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Header</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {#if headerRows.length > 0}
                  {#each headerRows as header (`${header.name}:${header.value}`)}
                    <TableRow>
                      <TableCell>{header.name}</TableCell>
                      <TableCell class="max-w-[18rem] truncate">{header.value}</TableCell>
                    </TableRow>
                  {/each}
                {:else}
                  <TableRow>
                    <TableCell colspan={2}>No custom headers.</TableCell>
                  </TableRow>
                {/if}
              </TableBody>
            </Table>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cookie</TableHead>
                  <TableHead>Scope</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {#if cookieRows.length > 0}
                  {#each cookieRows as cookie (`${cookie.name}:${cookie.domain ?? cookie.url ?? cookie.path ?? ''}`)}
                    <TableRow>
                      <TableCell>{cookie.name}</TableCell>
                      <TableCell>{cookie.domain ?? cookie.url ?? cookie.path ?? 'session'}</TableCell>
                    </TableRow>
                  {/each}
                {:else}
                  <TableRow>
                    <TableCell colspan={2}>No cookies were configured.</TableCell>
                  </TableRow>
                {/if}
              </TableBody>
            </Table>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Step</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {#each flowRows as step (step.id)}
                  <TableRow>
                    <TableCell>{step.step}. {step.type}</TableCell>
                    <TableCell>{step.detail}</TableCell>
                  </TableRow>
                {/each}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card class="border-line/55 bg-white/[0.025] p-4">
          <div class="flex items-center justify-between gap-2">
            <div>
              <p class="text-[0.72rem] uppercase tracking-[0.18em] text-muted">Issues</p>
              <p class="text-sm text-muted">Worker-reported issues stay separate from the top-level failure message.</p>
            </div>
            <Badge tone="muted">{issueRows.length}</Badge>
          </div>

          <Table class="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#if issueRows.length > 0}
                {#each issueRows as issue (`${issue.severity}:${issue.code}:${issue.message}`)}
                  <TableRow>
                    <TableCell>{issue.severity}</TableCell>
                    <TableCell>{issue.code}</TableCell>
                    <TableCell>{issue.message}</TableCell>
                  </TableRow>
                {/each}
              {:else}
                <TableRow>
                  <TableCell colspan={3}>No structured issues were recorded for this run.</TableCell>
                </TableRow>
              {/if}
            </TableBody>
          </Table>
        </Card>
      </div>
    {/if}
  </div>
{/if}
