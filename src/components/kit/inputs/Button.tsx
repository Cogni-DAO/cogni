// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/inputs/Button`
 * Purpose: Button component wrapper using CVA styling with Radix Slot composition for interactive actions.
 * Scope: Provides Button component with variant props. Does not handle form submission or navigation routing.
 * Invariants: Forwards ref; accepts aria-* and data-* unchanged; always renders valid button or slot.
 * Side-effects: none
 * Notes: Uses CVA factory from \@/styles/ui - no literal classes allowed; supports asChild pattern.
 * Links: docs/spec/ui-implementation.md
 * @public
 */

import { Slot } from "@radix-ui/react-slot";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cloneElement, forwardRef, isValidElement } from "react";

import { cn } from "@/shared/util";
import { button, icon } from "@/styles/ui";

type ButtonBaseProps = ComponentProps<"button">;

export interface ButtonProps
  extends Omit<ButtonBaseProps, "className">,
    VariantProps<typeof button> {
  asChild?: boolean;
  /**
   * Optional className for layout/composition overrides only (flex/gap/margins).
   * Colors/typography remain controlled by CVA variants.
   */
  className?: string;
  /**
   * Icon size variant
   */
  iconSize?: "sm" | "md" | "lg";
  /**
   * Right icon component (Lucide icon)
   */
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant,
      size,
      asChild = false,
      rightIcon,
      iconSize = "md",
      children,
      className,
      ...props
    },
    ref
  ) => {
    const iconElement = rightIcon ? (
      <span aria-hidden="true" className={icon({ size: iconSize })}>
        {rightIcon}
      </span>
    ) : null;

    if (asChild) {
      if (!isValidElement(children)) {
        throw new Error(
          "Button with `asChild` expects a single React element child."
        );
      }

      const childElement = children as ReactElement<{ children?: ReactNode }>;

      const childWithIcon =
        iconElement && childElement.props
          ? cloneElement(childElement, {
              ...childElement.props,
              children: (
                <>
                  {childElement.props.children}
                  {iconElement}
                </>
              ),
            })
          : childElement;

      return (
        <Slot
          className={cn(button({ variant, size }), className)}
          data-slot="button"
          ref={ref}
          {...props}
        >
          {childWithIcon}
        </Slot>
      );
    }

    return (
      <button
        className={cn(button({ variant, size }), className)}
        data-slot="button"
        ref={ref}
        {...props}
      >
        {children}
        {iconElement}
      </button>
    );
  }
);

Button.displayName = "Button";
