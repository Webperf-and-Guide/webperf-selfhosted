import { z } from 'zod';

export const defaultRegionCodesJson = '["tokyo","singapore","frankfurt","newyork"]';
export const defaultRegionIdsJson = '{"tokyo":"JP","singapore":"SG","frankfurt":"DE","newyork":"US"}';
export const defaultSelfhostRegionCodesJson = '["tokyo"]';
export const defaultSelfhostProbeBaseUrlsJson = '{"tokyo":"http://127.0.0.1:8080"}';

export const emptyStringToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
