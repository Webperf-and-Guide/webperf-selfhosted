<script lang="ts">
  import { RunStatusPanel } from '@webperf/ui/components/operator/run-status-panel';
  import type { LatencyJobDetail } from '@webperf/contracts';

  type Target = LatencyJobDetail['targets'][number];

  let {
    target,
    formatText,
    formatTiming
  } = $props<{
    target: Target;
    formatText: (value: string | null | undefined) => string;
    formatTiming: (value: number | null | undefined) => string;
  }>();

  const summaryItems = $derived.by(() => [
    { id: 'attempt', label: 'Attempt', value: target.attemptNo },
    {
      id: 'latency',
      label: 'Latency',
      value: target.latencyMs == null ? 'pending' : `${target.latencyMs} ms`
    },
    { id: 'status-code', label: 'Status code', value: target.statusCode ?? 'n/a' },
    { id: 'implementation', label: 'Implementation', value: target.probeImpl ?? 'pending' },
    { id: 'slot', label: 'Slot', value: target.slotId ?? 'allocating' }
  ]);

  const detailItems = $derived.by(() =>
    target.measurement
      ? [
          { id: 'final-url', label: 'Final URL', value: formatText(target.measurement.finalUrl) },
          { id: 'redirects', label: 'Redirects', value: target.measurement.redirectCount },
          { id: 'total', label: 'Total', value: formatTiming(target.measurement.timings.totalMs) },
          { id: 'dns', label: 'DNS', value: formatTiming(target.measurement.timings.dnsMs) },
          { id: 'tcp', label: 'TCP', value: formatTiming(target.measurement.timings.tcpMs) },
          { id: 'tls', label: 'TLS', value: formatTiming(target.measurement.timings.tlsMs) },
          { id: 'ttfb', label: 'TTFB', value: formatTiming(target.measurement.timings.ttfbMs) },
          { id: 'tls-version', label: 'TLS version', value: formatText(target.measurement.tls?.version) },
          { id: 'alpn', label: 'ALPN', value: formatText(target.measurement.tls?.alpn) },
          { id: 'cipher', label: 'Cipher', value: formatText(target.measurement.tls?.cipherSuite) },
          { id: 'server-name', label: 'Server name', value: formatText(target.measurement.tls?.serverName) }
        ]
      : []
  );

  const statusTone = $derived.by(() => {
    switch (target.status) {
      case 'succeeded':
        return 'success';
      case 'failed':
        return 'danger';
      case 'running':
      case 'provisioning':
        return 'accent';
      default:
        return 'muted';
    }
  });
</script>

<RunStatusPanel
  class="result-card"
  details={detailItems}
  errorMessage={target.errorMessage}
  status={target.status}
  {statusTone}
  summary={summaryItems}
  title={target.region}
/>
