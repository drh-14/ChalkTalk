/// <reference types="vite/client" />
import { useContext } from "react";
import { ConfirmContext, type Confirm } from "./confirmContext.js";

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (confirm) return confirm;
  throw new Error("ConfirmProvider is required for in-app confirmations");
}
