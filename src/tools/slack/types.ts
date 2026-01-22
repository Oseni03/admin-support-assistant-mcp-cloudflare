import { SlackContext } from "./context";

export type SlackTool<T> = (
  ctx: SlackContext,
  args: T,
) => Promise<{
  content: { type: "text"; text: string }[];
}>;
