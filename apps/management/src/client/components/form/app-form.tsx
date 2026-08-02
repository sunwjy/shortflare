import { createFormHook, createFormHookContexts, useStore } from "@tanstack/react-form";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";

const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts();

type TextFieldProps = Omit<
  ComponentProps<typeof Input>,
  "id" | "name" | "onBlur" | "onChange" | "value"
> &
  Readonly<{
    label: ReactNode;
    description?: ReactNode;
  }>;

function TextField({ label, description, ...inputProps }: TextFieldProps) {
  const field = useFieldContext<string>();
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const descriptionId = description ? `${field.name}-description` : undefined;
  const errorId = invalid ? `${field.name}-error` : undefined;

  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        value={field.state.value}
        aria-describedby={[descriptionId, errorId].filter(Boolean).join(" ") || undefined}
        aria-invalid={invalid}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        {...inputProps}
      />
      {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      {invalid && <FieldError id={errorId}>{fieldErrorText(field.state.meta.errors)}</FieldError>}
    </Field>
  );
}

function PasswordField(props: Omit<TextFieldProps, "type">) {
  return <TextField type="password" {...props} />;
}

function CheckboxField({
  label,
  description,
}: Readonly<{ label: ReactNode; description?: ReactNode }>) {
  const field = useFieldContext<boolean>();
  const descriptionId = description ? `${field.name}-description` : undefined;

  return (
    <Field orientation="horizontal">
      <Checkbox
        id={field.name}
        checked={field.state.value}
        aria-describedby={descriptionId}
        onBlur={field.handleBlur}
        onCheckedChange={field.handleChange}
      />
      <div className="grid gap-1">
        <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
        {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      </div>
    </Field>
  );
}

function SelectField({
  label,
  options,
}: Readonly<{
  label: ReactNode;
  options: readonly Readonly<{ label: string; value: string }>[];
}>) {
  const field = useFieldContext<string>();

  return (
    <Field>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <NativeSelect
        className="w-full"
        id={field.name}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
      >
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}

type SubmitButtonProps = Omit<ComponentProps<typeof Button>, "disabled" | "type"> &
  Readonly<{ pendingLabel: ReactNode }>;

function SubmitButton({ children, pendingLabel, ...buttonProps }: SubmitButtonProps) {
  const form = useFormContext();
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

  return (
    <Button type="submit" disabled={isSubmitting} {...buttonProps}>
      {isSubmitting ? pendingLabel : children}
    </Button>
  );
}

function fieldErrorText(errors: readonly unknown[]) {
  const messages = errors.flatMap((error) => {
    if (typeof error === "string") return [error];
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      return [error.message];
    }
    return [];
  });
  return [...new Set(messages)].join(" ");
}

export const { useAppForm } = createFormHook({
  fieldComponents: { CheckboxField, PasswordField, SelectField, TextField },
  formComponents: { SubmitButton },
  fieldContext,
  formContext,
});
