import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
import { DialogShell } from "../components/DialogShell";
import { errorMessage } from "../error-message";

type CreateProjectInput = {
  name: string;
  projectFolder: string;
  description?: string;
};

type ProjectFieldErrors = Partial<
  Record<"name" | "projectFolder", string>
>;

export function CreateProjectDialog({
  open,
  onClose,
  onCreate,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateProjectInput) => Promise<string>;
  onCreated: (projectId: string) => void;
}) {
  const [name, setName] = useState("");
  const [projectFolder, setProjectFolder] = useState("");
  const [description, setDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState({ name: false, projectFolder: false });
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string>();
  const nameRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setProjectFolder("");
    setDescription("");
    setSubmitted(false);
    setTouched({ name: false, projectFolder: false });
    setSubmitting(false);
    setApiError(undefined);
  }, [open]);

  if (!open) return null;

  const errors = validateProjectFields(name, projectFolder);
  const nameError = submitted || touched.name ? errors.name : undefined;
  const folderError =
    submitted || touched.projectFolder ? errors.projectFolder : undefined;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setApiError(undefined);
    const nextErrors = validateProjectFields(name, projectFolder);
    if (nextErrors.name) {
      nameRef.current?.focus();
      return;
    }
    if (nextErrors.projectFolder) {
      folderRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const projectId = await onCreate({
        name: name.trim(),
        projectFolder: projectFolder.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setSubmitting(false);
      onClose();
      onCreated(projectId);
    } catch (caught) {
      setApiError(errorMessage(caught));
      setSubmitting(false);
    }
  };

  return (
    <DialogShell
      title="New Project"
      description="Create a project workspace for project-scoped sessions."
      onClose={onClose}
      initialFocusRef={nameRef}
      closeLabel="Cancel project creation"
      closeDisabled={submitting}
    >
      <form className="grid gap-4 p-4" onSubmit={submit} noValidate>
        <DialogField label="Name" required error={nameError} errorId="create-project-name-error">
          <input
            ref={nameRef}
            id="create-project-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setApiError(undefined);
            }}
            onBlur={() => setTouched((current) => ({ ...current, name: true }))}
            required
            maxLength={120}
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? "create-project-name-help create-project-name-error" : "create-project-name-help"}
            className="h-9 w-full rounded-sm border border-slate-700 bg-[#0e1116] px-3 text-sm text-slate-100 outline-none focus:border-[#11a4d4] focus:ring-1 focus:ring-[#11a4d4]"
          />
          <div id="create-project-name-help" className="mt-1 text-[11px] text-slate-500">
            Required. Maximum 120 characters.
          </div>
        </DialogField>

        <DialogField label="Folder" required error={folderError} errorId="create-project-folder-error">
          <input
            ref={folderRef}
            id="create-project-folder"
            value={projectFolder}
            onChange={(event) => {
              setProjectFolder(event.target.value);
              setApiError(undefined);
            }}
            onBlur={() =>
              setTouched((current) => ({ ...current, projectFolder: true }))
            }
            required
            aria-invalid={Boolean(folderError)}
            aria-describedby={folderError ? "create-project-folder-help create-project-folder-error" : "create-project-folder-help"}
            placeholder="~/code/my-project or /home/me/code/my-project"
            className="h-9 w-full rounded-sm border border-slate-700 bg-[#0e1116] px-3 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#11a4d4] focus:ring-1 focus:ring-[#11a4d4]"
          />
          <div id="create-project-folder-help" className="mt-1 text-[11px] text-slate-500">
            Use an absolute path or a path beginning with ~/.
          </div>
        </DialogField>

        <DialogField label="Description" optional>
          <input
            id="create-project-description"
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setApiError(undefined);
            }}
            className="h-9 w-full rounded-sm border border-slate-700 bg-[#0e1116] px-3 text-sm text-slate-100 outline-none focus:border-[#11a4d4] focus:ring-1 focus:ring-[#11a4d4]"
          />
        </DialogField>

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
            Create project
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

function validateProjectFields(
  name: string,
  projectFolder: string,
): ProjectFieldErrors {
  const errors: ProjectFieldErrors = {};
  const trimmedName = name.trim();
  const trimmedFolder = projectFolder.trim();
  if (!trimmedName) errors.name = "Enter a project name.";
  else if (trimmedName.length > 120)
    errors.name = "Project name must be 120 characters or fewer.";
  if (!trimmedFolder) errors.projectFolder = "Enter a project folder.";
  else if (!trimmedFolder.startsWith("/") && !trimmedFolder.startsWith("~/"))
    errors.projectFolder = "Use an absolute path or a path beginning with ~/...";
  return errors;
}

function DialogField({
  label,
  required,
  optional,
  error,
  errorId,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-300">
      <span>
        {label}
        {required ? <span className="ml-1 text-[#8bdcf4]">required</span> : null}
        {optional ? <span className="ml-1 font-normal text-slate-500">optional</span> : null}
      </span>
      <div className="mt-1.5">{children}</div>
      {error && errorId ? (
        <div id={errorId} className="mt-1 text-[11px] text-red-300" role="alert">
          {error}
        </div>
      ) : null}
    </label>
  );
}
