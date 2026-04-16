import { toaster } from "@/components/ui/toaster";

type ToastType = "success" | "error" | "warning" | "info" | "loading";

/**
 * ToastWizard — global toast utility (no hook required).
 *
 * Standard usage:
 *   ToastWizard.standard("success", "Saved", "Your changes were saved.")
 *   ToastWizard.standard("error", "Failed", "Something went wrong.", 5000, true)
 *
 * With action:
 *   ToastWizard.standard("warning", "Unsaved", null, 5000, true, () => save(), "Save")
 *
 * Promise-based usage:
 *   ToastWizard.promiseBased(
 *     myPromise,
 *     "Done",    "Completed successfully",
 *     "Error",   "Something went wrong",
 *     "Loading", "Please wait…"
 *   )
 */
class ToastWizard {
  static standard(
    type: ToastType,
    title: string,
    description: string | null = null,
    duration = 3000,
    closable = false,
    action: (() => void) | null = null,
    actionLabel: string | null = null,
  ) {
    return toaster.create({
      type,
      title,
      description: description ?? undefined,
      duration,
      closable,
      action: action && actionLabel ? { label: actionLabel, onClick: action } : undefined,
    });
  }

  static promiseBased(
    promise: Promise<unknown>,
    successTitle: string,
    successDescription: string,
    errorTitle: string,
    errorDescription: string,
    loadingTitle: string,
    loadingDescription: string,
    action: (() => void) | null = null,
    actionLabel: string | null = null,
    actionForTypes: ToastType[] = [],
  ) {
    return toaster.promise(promise, {
      success: {
        title: successTitle,
        description: successDescription,
        action:
          action && actionLabel && actionForTypes.includes("success")
            ? { label: actionLabel, onClick: action }
            : undefined,
      },
      error: {
        title: errorTitle,
        description: errorDescription,
        action:
          action && actionLabel && actionForTypes.includes("error")
            ? { label: actionLabel, onClick: action }
            : undefined,
      },
      loading: {
        title: loadingTitle,
        description: loadingDescription,
        action:
          action && actionLabel && actionForTypes.includes("loading")
            ? { label: actionLabel, onClick: action }
            : undefined,
      },
    });
  }
}

export default ToastWizard;
