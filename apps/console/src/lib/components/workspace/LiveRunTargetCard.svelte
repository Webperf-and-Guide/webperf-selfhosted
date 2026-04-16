<script lang="ts">
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
</script>

<article class="result-card">
  <div class="result-head">
    <strong>{target.region}</strong>
    <span>{target.status}</span>
  </div>

  <dl>
    <div>
      <dt>Attempt</dt>
      <dd>{target.attemptNo}</dd>
    </div>
    <div>
      <dt>Latency</dt>
      <dd>{target.latencyMs == null ? 'pending' : `${target.latencyMs} ms`}</dd>
    </div>
    <div>
      <dt>Status code</dt>
      <dd>{target.statusCode ?? 'n/a'}</dd>
    </div>
    <div>
      <dt>Implementation</dt>
      <dd>{target.probeImpl ?? 'pending'}</dd>
    </div>
    <div>
      <dt>Slot</dt>
      <dd>{target.slotId ?? 'allocating'}</dd>
    </div>
  </dl>

  {#if target.measurement}
    <div class="measurement-details">
      <div>
        <span>Final URL</span>
        <strong>{formatText(target.measurement.finalUrl)}</strong>
      </div>
      <div>
        <span>Redirects</span>
        <strong>{target.measurement.redirectCount}</strong>
      </div>
      <div>
        <span>Total</span>
        <strong>{formatTiming(target.measurement.timings.totalMs)}</strong>
      </div>
      <div>
        <span>DNS</span>
        <strong>{formatTiming(target.measurement.timings.dnsMs)}</strong>
      </div>
      <div>
        <span>TCP</span>
        <strong>{formatTiming(target.measurement.timings.tcpMs)}</strong>
      </div>
      <div>
        <span>TLS</span>
        <strong>{formatTiming(target.measurement.timings.tlsMs)}</strong>
      </div>
      <div>
        <span>TTFB</span>
        <strong>{formatTiming(target.measurement.timings.ttfbMs)}</strong>
      </div>
      <div>
        <span>TLS version</span>
        <strong>{formatText(target.measurement.tls?.version)}</strong>
      </div>
      <div>
        <span>ALPN</span>
        <strong>{formatText(target.measurement.tls?.alpn)}</strong>
      </div>
      <div>
        <span>Cipher</span>
        <strong>{formatText(target.measurement.tls?.cipherSuite)}</strong>
      </div>
      <div>
        <span>Server name</span>
        <strong>{formatText(target.measurement.tls?.serverName)}</strong>
      </div>
    </div>
  {/if}

  {#if target.errorMessage}
    <p class="error">{target.errorMessage}</p>
  {/if}
</article>
