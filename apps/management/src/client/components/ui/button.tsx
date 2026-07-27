import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const buttonVariants = cva("button", {
  variants: {
    variant: {
      primary: "button--primary",
      secondary: "button--secondary",
      quiet: "button--quiet",
      danger: "button--danger",
    },
    size: {
      default: "button--default",
      large: "button--large",
      icon: "button--icon",
    },
  },
  defaultVariants: {
    variant: "primary",
    size: "default",
  },
});

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
