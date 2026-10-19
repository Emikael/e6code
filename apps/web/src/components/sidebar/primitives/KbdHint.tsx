import type { ReactNode } from "react";
import { Kbd } from "~/components/ui/kbd";

export function KbdHint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Kbd variant="switchboard" className={className}>
      {children}
    </Kbd>
  );
}
