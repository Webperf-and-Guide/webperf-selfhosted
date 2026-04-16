import type {
  CheckProfileComparisonResponse,
  CheckProfileLatestComparisonResponse
} from '@webperf/contracts';

export type ComparisonSection = {
  id: string;
  title: string;
  subtitle: string;
  comparison: CheckProfileLatestComparisonResponse | CheckProfileComparisonResponse;
};
