import { GmailContext } from "./context";

export type GmailTool<T> = (
  ctx: GmailContext,
  args: T,
) => Promise<{
  content: { type: "text"; text: string }[];
}>;
