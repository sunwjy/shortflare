import { z } from "zod";

export const emailSchema = z.email("Enter a valid email address.");

export const destinationSchema = z.string().superRefine((value, context) => {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return;
  } catch {
    // The single issue below keeps malformed and unsafe URLs indistinguishable.
  }
  context.addIssue({ code: "custom", message: "Enter a safe HTTP or HTTPS Destination." });
});

export const linkTitleSchema = z
  .string()
  .trim()
  .min(1, "Enter a title.")
  .max(200, "Use at most 200 characters.");

export const passwordSchema = z.string().superRefine((password, context) => {
  const length = Array.from(password.normalize("NFC")).length;
  if (length < 15 || length > 128) {
    context.addIssue({
      code: "custom",
      message: "Use 15 to 128 characters.",
    });
  }
});
