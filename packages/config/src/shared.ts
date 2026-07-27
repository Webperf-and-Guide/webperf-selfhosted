import { z } from 'zod';

/**
 * Issue #14 Phase 1 single-region defaults.
 *
 * `local` is the deployment-owned identity for one standalone runtime. It is
 * deliberately not a city claim; operators reconfigure it to their actual
 * region identity (e.g. `kr-seoul-office`, `aws-ap-northeast-2`).
 *
 * The legacy `SELFHOST_*_JSON` maps and the 41-city defaults were removed in
 * PR2 of Phase 1 because one standalone deployment measures from one fixed
 * runtime location.
 */
export const defaultSelfhostRegionId = 'local';
export const defaultSelfhostProbeBaseUrl = 'http://127.0.0.1:8080';

export const emptyStringToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
