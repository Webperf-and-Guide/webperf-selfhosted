<script lang="ts">
  import { Card } from '@webperf/ui/components/ui/card';
  import { CopyButton } from '@webperf/ui/components/ui/copy-button';
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
  } from '@webperf/ui/components/ui/table';

  let {
    endpoints
  } = $props<{
    endpoints: Array<{
      resource: string;
      purpose: string;
      path: string;
    }>;
  }>();
</script>

<Card class="p-4">
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Resource</TableHead>
        <TableHead>Purpose</TableHead>
        <TableHead>Path</TableHead>
        <TableHead class="text-right">Action</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {#each endpoints as endpoint (endpoint.path)}
        <TableRow>
          <TableCell>{endpoint.resource}</TableCell>
          <TableCell>{endpoint.purpose}</TableCell>
          <TableCell><code>{endpoint.path}</code></TableCell>
          <TableCell class="text-right">
            <CopyButton text={endpoint.path}>Copy path</CopyButton>
          </TableCell>
        </TableRow>
      {/each}
    </TableBody>
  </Table>
</Card>
