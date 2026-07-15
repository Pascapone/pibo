import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { DialogShell } from "../components/DialogShell";
import { errorMessage } from "../error-message";

export function CreateWorkflowDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string>();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setSubmitted(false);
    setTouched(false);
    setSubmitting(false);
    setApiError(undefined);
  }, [open]);

  if (!open) return null;

  const nameError = submitted || touched ? validateWorkflowName(name) : undefined;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setApiError(undefined);
    const nextError = validateWorkflowName(name);
    if (nextError) {
      nameRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await onCreate(name.trim());
      setSubmitting(false);
      onClose();
    } catch (caught) {
      setApiError(errorMessage(caught));
      setSubmitting(false);
    }
  };

  return (
    <DialogShell
      title="Create workflow"
      description="Create a new editable workflow draft."
      onClose={onClose}
      initialFocusRef={nameRef}
      closeLabel="Cancel workflow creation"
      closeDisabled={submitting}
    >
      <form className="grid gap-4 p-4" onSubmit={submit} noValidate>
        <label className="block text-xs font-semibold text-slate-300">
          <span>
            Name <span className="ml-1 text-[#8bdcf4]">required</span>
          </span>
          <input
            ref={nameRef}
            id="create-workflow-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setApiError(undefined);
            }}
            onBlur={() => setTouched(true)}
            required
            maxLength={160}
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? "create-workflow-name-help create-workflow-name-error" : "create-workflow-name-help"}
            className="mt-1.5 h-9 w-full rounded-sm border border-slate-700 bg-[#0e1116] px-3 text-sm text-slate-100 outline-none focus:border-[#11a4d4] focus:ring-1 focus:ring-[#11a4d4]"
          />
          <div id="create-workflow-name-help" className="mt-1 text-[11px] text-slate-500">
            Maximum 160 characters.
          </div>
          {nameError ? (
            <div id="create-workflow-name-error" className="mt-1 text-[11px] text-red-300" role="alert">
              {nameError}
            </div>
          ) : null}
        </label>

        {apiError ? (
          <div
            className="rounded-sm border border-red-900/70 bg-red-950/30 px-3 py-2 text-xs text-red-200"
            role="alert"
          >
            {apiError}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-8 rounded-sm border border-slate-700 px-3 text-xs text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-8 items-center gap-2 rounded-sm bg-[#11a4d4] px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : null}
            Create workflow
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

function validateWorkflowName(name: string): string | undefined {
  const trimmedName = name.trim();
  if (!trimmedName) return "Enter a workflow name.";
  if (trimmedName.length > 160)
    return "Workflow name must be 160 characters or fewer.";
  return undefined;
}
