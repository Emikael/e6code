import { useEffect, useSyncExternalStore } from "react";

import {
  completeImportedCookieApprovalClose,
  readImportedCookieApprovalState,
  registerImportedCookieApprovalHost,
  respondToImportedCookieApproval,
  subscribeImportedCookieApproval,
} from "../importedCookieApprovalDialog";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";

export function ImportedCookieApprovalDialogHost() {
  const state = useSyncExternalStore(
    subscribeImportedCookieApproval,
    readImportedCookieApprovalState,
    readImportedCookieApprovalState,
  );
  useEffect(() => registerImportedCookieApprovalHost(), []);

  const message = state.status === "idle" ? "" : state.message;
  const questionMark = message.indexOf("?");
  const title =
    questionMark >= 0 ? message.slice(0, questionMark + 1).trim() : "Allow agent access?";
  const description = questionMark >= 0 ? message.slice(questionMark + 1).trim() : message;

  return (
    <AlertDialog
      open={state.status === "confirming"}
      onOpenChange={(open) => {
        if (!open) respondToImportedCookieApproval(false);
      }}
      onOpenChangeComplete={(open) => {
        if (!open) completeImportedCookieApprovalClose();
      }}
    >
      <AlertDialogPopup className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="wrap-anywhere">{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription className="whitespace-pre-line">
              {description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" autoFocus />}>
            Don't allow
          </AlertDialogClose>
          <Button variant="destructive" onClick={() => respondToImportedCookieApproval(true)}>
            Allow
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
