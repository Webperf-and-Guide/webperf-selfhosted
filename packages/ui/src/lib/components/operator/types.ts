import type { ButtonSize, ButtonVariant } from '../ui/button';

export type OperatorTone = 'default' | 'muted' | 'accent' | 'success' | 'warning' | 'danger';

export type MetricGridItem = {
  id?: string;
  label: string;
  value: string | number;
  detail?: string;
  tone?: OperatorTone;
};

export type OperatorActionItem =
  | {
      id?: string;
      kind?: 'button';
      label: string;
      variant?: ButtonVariant;
      size?: ButtonSize;
      disabled?: boolean;
      onclick?: () => void;
    }
  | {
      id?: string;
      kind: 'copy';
      label: string;
      text: string;
      variant?: ButtonVariant;
      size?: ButtonSize;
    };

export type RegionQuickPickItem = {
  id: string;
  label: string;
  description?: string;
  selected?: boolean;
  disabled?: boolean;
  onclick?: () => void;
};

export type ComparisonRegionCard = {
  id: string;
  title: string;
  classification?: string;
  tone?: OperatorTone;
  stats: MetricGridItem[];
};

export type ComparisonRouteGroup = {
  id: string;
  title: string;
  subtitle?: string;
  regions: ComparisonRegionCard[];
};

export type ComparisonSummaryData = {
  id: string;
  title: string;
  subtitle?: string;
  modeLabel?: string;
  summary: MetricGridItem[];
  actions?: OperatorActionItem[];
  routes?: ComparisonRouteGroup[];
};

export type RunHistoryTargetItem = {
  id: string;
  label: string;
  value: string;
};

export type RunHistoryJobItem = {
  id: string;
  title: string;
  subtitle?: string;
  targets: RunHistoryTargetItem[];
};

export type RunHistoryEntry = {
  id: string;
  title: string;
  subtitle?: string;
  summary: MetricGridItem[];
  actions?: OperatorActionItem[];
  jobs: RunHistoryJobItem[];
};

export type DerivedResourceTab = {
  value: string;
  label: string;
};

export type DerivedResourceItem = {
  id: string;
  createdAtLabel: string;
  summary: string[];
  tone?: OperatorTone;
};
