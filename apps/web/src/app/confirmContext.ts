import { createContext } from "react";

export type ConfirmOptions = {
  message: string;
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
};
export type Confirm = (request: string | ConfirmOptions) => Promise<boolean>;
export const ConfirmContext = createContext<Confirm | null>(null);
