import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock3,
  Eye,
  ListChecks,
  MessageCircleQuestion,
  ShieldQuestion,
  Sparkles,
} from "lucide-react";

export const SWITCHBOARD_STATUS = {
  approval: { label: "Approval needed", icon: ShieldQuestion },
  input: { label: "Input needed", icon: MessageCircleQuestion },
  plan: { label: "Plan ready", icon: ListChecks },
  working: { label: "Working", icon: CircleDashed },
  connecting: { label: "Connecting", icon: CircleDashed },
  monitoring: { label: "Monitoring", icon: Eye },
  completed: { label: "Completed", icon: CircleCheck },
  error: { label: "Error", icon: CircleAlert },
  ready: { label: "Ready", icon: Circle },
  snoozed: { label: "Snoozed", icon: Clock3 },
  woke: { label: "Woke", icon: Sparkles },
} as const;

export type SwitchboardStatus = keyof typeof SWITCHBOARD_STATUS;
