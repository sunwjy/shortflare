import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { ApiError, jsonRequest } from "../../api";
import { linkResponseSchema } from "../../api-schemas";
import { useAppForm } from "../../components/form/app-form";
import { destinationSchema, linkTitleSchema } from "../../components/form/form-schemas";
import { Button } from "../../components/ui/button";

const rootApi = getRouteApi("__root__");
const linksApi = getRouteApi("/links");
const createLinkApi = getRouteApi("/links/new");

const createLinkSchema = z
  .object({
    destination: destinationSchema,
    title: linkTitleSchema,
    customAlias: z.boolean(),
    alias: z.string(),
  })
  .superRefine(({ customAlias, alias }, context) => {
    if (customAlias && !/^[0-9A-Za-z_-]{1,64}$/.test(alias)) {
      context.addIssue({
        code: "custom",
        message: "Use 1–64 letters, numbers, hyphens, or underscores.",
        path: ["alias"],
      });
    }
  });

export function CreateLinkPanel() {
  const { session } = rootApi.useRouteContext();
  const navigate = createLinkApi.useNavigate();
  const search = linksApi.useSearch();
  const queryClient = useQueryClient();
  const [creationError, setCreationError] = useState("");
  const form = useAppForm({
    defaultValues: { destination: "", title: "", customAlias: false, alias: "" },
    validators: {
      onBlur: createLinkSchema,
      onChange: createLinkSchema,
      onSubmit: createLinkSchema,
    },
    onSubmit: async ({ value }) => {
      setCreationError("");
      try {
        const { link } = await jsonRequest("/api/internal/links", linkResponseSchema, {
          method: "POST",
          csrfToken: session.csrfToken,
          body: {
            ...(value.customAlias ? { alias: value.alias } : {}),
            destination: value.destination,
            title: value.title,
          },
        });
        queryClient.setQueryData(["link", link.id], { ok: true, link });
        await queryClient.invalidateQueries({ queryKey: ["links"] });
        await navigate({
          to: "/links/$linkId",
          params: { linkId: link.id },
          search,
          replace: true,
        });
      } catch (error) {
        setCreationError(linkMutationError(error));
      }
    },
  });

  return (
    <aside
      className="fixed inset-0 z-20 overflow-auto bg-card p-6 text-card-foreground shadow-2xl md:inset-y-0 md:right-0 md:left-auto md:w-full md:max-w-xl md:border-l"
      aria-label="Create Link panel"
    >
      <div className="mb-7 flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-semibold text-primary">New short path</p>
          <h2 className="text-xl font-semibold tracking-tight">Create Link</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close Create Link"
          onClick={() => void navigate({ to: "/links", search })}
        >
          <X aria-hidden="true" size={18} strokeWidth={1.75} />
        </Button>
      </div>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="destination">
          {(field) => (
            <field.TextField
              label="Destination"
              type="url"
              placeholder="https://example.com/page"
              description="Where this Link sends visitors."
            />
          )}
        </form.AppField>
        <form.AppField name="customAlias">
          {(field) => <field.CheckboxField label="Use a custom Alias" />}
        </form.AppField>
        <form.Subscribe selector={(state) => state.values.customAlias}>
          {(customAlias) =>
            customAlias ? (
              <form.AppField name="alias">
                {(field) => (
                  <field.TextField
                    label="Alias"
                    autoComplete="off"
                    maxLength={64}
                    description="Case-sensitive. Letters, numbers, hyphens, and underscores."
                  />
                )}
              </form.AppField>
            ) : (
              <p className="text-xs text-muted-foreground">
                A six-character Alias will be generated.
              </p>
            )
          }
        </form.Subscribe>
        <form.AppField name="title">
          {(field) => (
            <field.TextField
              label="Title"
              maxLength={200}
              description="A clear internal name for this Link."
            />
          )}
        </form.AppField>
        <form.Subscribe selector={(state) => state.values}>
          {({ customAlias, alias }) =>
            customAlias && alias ? (
              <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                Short path preview <code className="font-mono text-foreground">/{alias}</code>
              </p>
            ) : null
          }
        </form.Subscribe>
        {creationError && (
          <p className="text-sm text-destructive" role="alert">
            {creationError}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void navigate({ to: "/links", search })}
          >
            Cancel
          </Button>
          <form.AppForm>
            <form.SubmitButton pendingLabel="Creating…">Create Link</form.SubmitButton>
          </form.AppForm>
        </div>
      </form>
    </aside>
  );
}

export function linkMutationError(error: unknown) {
  if (!(error instanceof ApiError)) return "The Link could not be saved.";
  return (
    {
      "alias-in-use": "That Alias already belongs to another Link.",
      "alias-reserved": "That Alias is reserved and cannot be reused.",
      "invalid-alias": "Use 1–64 letters, numbers, hyphens, or underscores.",
      "invalid-destination": "Enter a safe HTTP or HTTPS Destination.",
      "invalid-title": "Enter a title between 1 and 200 characters.",
    }[error.body.kind] ?? "The Link could not be saved."
  );
}
