export const themes = {
  operator: 'operator',
  brand: 'brand',
  brandDark: 'brand-dark'
} as const;

export type AppTheme = (typeof themes)[keyof typeof themes];

export const consoleShellLinks = [
  { href: '/', label: 'Run' },
  { href: '/resources', label: 'Resources' },
  { href: '/checks', label: 'Checks' },
  { href: '/reports', label: 'Reports' },
  { href: '/regions', label: 'Regions' },
  { href: '/api/control/health', label: 'Control Health' }
] as const;

export const cloudConsoleShellLinks = [
  { href: '/', label: 'Run' },
  { href: '/resources', label: 'Resources' },
  { href: '/checks', label: 'Checks' },
  { href: '/reports', label: 'Reports' },
  { href: '/regions', label: 'Regions' }
] as const;

export const marketingShellLinks = [
  { href: '/#positioning', label: 'Positioning' },
  { href: '/#compare', label: 'Compare' },
  { href: '/posts', label: 'Posts' },
  { href: '/#roadmap', label: 'Roadmap' }
] as const;

export { cn } from './cn';
export { Badge } from './lib/components/ui/badge';
export {
  Button,
  buttonVariants,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant
} from './lib/components/ui/button';
export { Card } from './lib/components/ui/card';
export { Checkbox } from './lib/components/ui/checkbox';
export { CopyButton } from './lib/components/ui/copy-button';
export { ComparisonSummaryPanel } from './lib/components/operator/comparison-summary-panel';
export { DerivedResourcePanel } from './lib/components/operator/derived-resource-panel';
export { InlineStatusNotice } from './lib/components/operator/inline-status-notice';
export { PagedListToolbar } from './lib/components/operator/paged-list-toolbar';
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
} from './lib/components/ui/dialog';
export {
  Root as FieldSet,
  Content as FieldSetContent,
  Footer as FieldSetFooter,
  Title as FieldSetTitle,
  fieldSetVariants,
  type RootProps as FieldSetProps,
  type TitleProps as FieldSetTitleProps,
  type ContentProps as FieldSetContentProps,
  type FooterProps as FieldSetFooterProps,
  type Variant as FieldSetVariant
} from './lib/components/ui/field-set';
export { Input } from './lib/components/ui/input';
export { MetricGrid } from './lib/components/operator/metric-grid';
export { OperatorEmptyState } from './lib/components/operator/operator-empty-state';
export { OperatorSectionHeader } from './lib/components/operator/operator-section-header';
export {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput
} from './lib/components/ui/number-field';
export {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverPortal,
  PopoverTitle,
  PopoverTrigger
} from './lib/components/ui/popover';
export { RegionQuickPick } from './lib/components/operator/region-quick-pick';
export { RegionContinentCard } from './lib/components/operator/region-continent-card';
export { ResourceEditorPanel } from './lib/components/operator/resource-editor-panel';
export { ResourceInventoryStrip } from './lib/components/operator/resource-inventory-strip';
export { ResourceCountStrip } from './lib/components/operator/resource-count-strip';
export { ResourceWorkflowStrip } from './lib/components/operator/resource-workflow-strip';
export { RunStatusPanel } from './lib/components/operator/run-status-panel';
export { SavedCheckSummaryCard } from './lib/components/operator/saved-check-summary-card';
export { ScrollArea, ScrollAreaScrollbar } from './lib/components/ui/scroll-area';
export { default as SegmentedNav } from './primitives/segmented-nav.svelte';
export { Select } from './lib/components/ui/select';
export { Separator } from './lib/components/ui/separator';
export { Spinner } from './lib/components/ui/spinner';
export { Switch } from './lib/components/ui/switch';
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow
} from './lib/components/ui/table';
export { Tabs, TabsContent, TabsList, TabsTrigger } from './lib/components/ui/tabs';
export { TagsInput, type TagsInputProps, type TagsInputPropsWithoutHTML } from './lib/components/ui/tags-input';
export { Textarea } from './lib/components/ui/textarea';
export { Tooltip, TooltipContent, TooltipPortal, TooltipProvider, TooltipTrigger } from './lib/components/ui/tooltip';
export {
  UnderlineTabs,
  UnderlineTabsContent,
  UnderlineTabsList,
  UnderlineTabsTrigger
} from './lib/components/ui/underline-tabs';
export type {
  ComparisonRegionCard,
  ComparisonRouteGroup,
  ComparisonSummaryData,
  DerivedResourceItem,
  DerivedResourceTab,
  InlineStatusTone,
  MetricGridItem,
  OperatorActionItem,
  OperatorTone,
  PagedListToolbarCopy,
  ResourceEditorPanelItem,
  ResourceWorkflowItem,
  RegionQuickPickItem,
  RunHistoryEntry,
  RunHistoryJobItem,
  RunHistoryTargetItem
} from './lib/components/operator/types';
