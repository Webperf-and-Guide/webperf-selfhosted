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
  { href: '#measure', label: 'Run' },
  { href: '#saved-checks', label: 'Checks' },
  { href: '#results', label: 'Reports' },
  { href: '#regions', label: 'Regions' }
] as const;

export const marketingShellLinks = [
  { href: '#positioning', label: 'Positioning' },
  { href: '#workflows', label: 'Workflows' },
  { href: '#open-core', label: 'Open Core' },
  { href: '#next', label: 'Next' }
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
