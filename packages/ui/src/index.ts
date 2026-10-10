// @kade/ui — Kadé design system. Import "@kade/ui/styles.css" once at each app's entry.

export { Icon, type IconName, type IconProps } from "./icons/Icon";
export { cx } from "./lib/cx";
export { formatRs, plural } from "./lib/format";
export { Link, UIProvider, type LinkProps } from "./lib/link";

export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./components/Button/Button";
export { IconButton, type IconButtonProps } from "./components/IconButton/IconButton";
export { Chip, type ChipProps } from "./components/Chip/Chip";
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentOption,
} from "./components/SegmentedControl/SegmentedControl";
export { Stepper, type StepperProps } from "./components/Stepper/Stepper";
export { Rating, Stars, type RatingProps } from "./components/Rating/Rating";
export { Tag, type TagProps, type TagTone } from "./components/Tag/Tag";
export {
  Container,
  EmptyState,
  SectionHeader,
  TextLink,
  Wordmark,
  type EmptyStateProps,
  type SectionHeaderProps,
} from "./components/Layout/Layout";
export { Shelf, type ShelfProps } from "./components/Shelf/Shelf";
export { RestaurantCard, type RestaurantCardProps } from "./components/RestaurantCard/RestaurantCard";
export {
  ConfirmDialog,
  Drawer,
  Sheet,
  type ConfirmDialogProps,
  type DrawerProps,
  type SheetProps,
} from "./components/Overlay/Overlay";
export {
  Choice,
  ChoiceGroup,
  SearchField,
  TextArea,
  Select,
  TextField,
  type ChoiceGroupProps,
  type ChoiceProps,
  type SearchFieldProps,
  type TextAreaProps,
  type SelectProps,
  type TextFieldProps,
} from "./components/Form/Form";

export { StarInput, type StarInputProps } from "./components/StarInput/StarInput";
export { Panel, type PanelProps } from "./components/Panel/Panel";
export { Switch, type SwitchProps } from "./components/Switch/Switch";
export { Tabs, type TabItem, type TabsProps } from "./components/Tabs/Tabs";
export { StatGroup, StatTile, type StatTileProps } from "./components/StatTile/StatTile";
export { DataTable, type Column, type DataTableProps } from "./components/DataTable/DataTable";
export { AppShell, type AppShellProps, type NavItem } from "./components/AppShell/AppShell";
export { ToastProvider } from "./components/Toast/Toast";
export { useToast, type ToastOptions } from "./components/Toast/toastContext";
