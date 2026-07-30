import { z } from 'zod';

/**
 * Generic runtime region identity for one self-hosted deployment.
 *
 * One standalone deployment represents one fixed measurement region, and the
 * operator chooses its identity (e.g. `kr-seoul-office`,
 * `aws-ap-northeast-2`, `home-lab`). The previous 41-city catalog and
 * `regionCodeSchema` enum were removed in Phase 1 of issue #14 because that
 * SaaS fan-out model belongs to the WebPerf & Guide managed service, not to one
 * standalone regional installation.
 *
 * Constraints:
 * - lowercase ascii letters, digits, and hyphens only
 * - must start and end with a letter or digit
 * - 1 to 64 characters
 * - safe to serialize and reuse as a stable identifier
 */
export const runtimeRegionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/,
    'Runtime region id must be 1-64 lowercase ASCII letters, digits, or hyphens, starting and ending with a letter or digit'
  );
export type RuntimeRegionId = z.infer<typeof runtimeRegionIdSchema>;

/**
 * Optional human-readable label for the configured runtime region.
 *
 * Defaults to the region id when omitted. Bounded to keep console cards,
 * provenance payloads, and exports readable.
 */
export const runtimeRegionLabelSchema = z.string().trim().min(1).max(120);
export type RuntimeRegionLabel = z.infer<typeof runtimeRegionLabelSchema>;

/**
 * Resolved runtime location for one deployment.
 *
 * `regionId` is the stable serialized identifier; `label` is the optional
 * display name that consumers resolve to the region id when omitted. Result
 * provenance records this object so historical reads keep their original
 * region values even after a future reconfiguration.
 */
export const runtimeLocationSchema = z.object({
  regionId: runtimeRegionIdSchema,
  label: runtimeRegionLabelSchema.optional()
});
export type RuntimeLocation = z.infer<typeof runtimeLocationSchema>;
