/* oxlint-disable react-perf/jsx-no-jsx-as-prop -- Base UI's render prop is the supported composition seam. */
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

import { Button } from "./button";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}>) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="dialog-backdrop" />
        <DialogPrimitive.Viewport className="dialog-viewport">
          <DialogPrimitive.Popup className="dialog-popup">
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description>{description}</DialogPrimitive.Description>
            {children}
            <DialogPrimitive.Close
              render={<Button type="button" variant="quiet" className="dialog-close" />}
            >
              Cancel
            </DialogPrimitive.Close>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
