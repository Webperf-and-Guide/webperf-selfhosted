import { z } from 'zod';

export const defaultRegionCodesJson = '["tokyo","singapore","frankfurt","newyork"]';
export const defaultRegionIdsJson = '{"tokyo":"JP","singapore":"SG","frankfurt":"DE","newyork":"US"}';
export const defaultSelfhostRegionCodesJson = '["tokyo"]';
export const defaultSelfhostProbeBaseUrlsJson = '{"tokyo":"http://127.0.0.1:8080"}';

/**
 * Issue #14 Phase 1 single-region defaults.
 *
 * `local` is the deployment-owned identity for one standalone runtime. It is
 * deliberately not a city claim; operators reconfigure it to their actual
 * region identity (e.g. `kr-seoul-office`, `aws-ap-northeast-2`).
 */
export const defaultSelfhostRegionId = 'local';
export const defaultSelfhostProbeBaseUrl = 'http://127.0.0.1:8080';

export const emptyStringToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
