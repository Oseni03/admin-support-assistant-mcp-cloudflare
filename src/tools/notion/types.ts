import { NotionContext } from "./context";

export type NotionTool<T> = (
  ctx: NotionContext,
  args: T,
) => Promise<{
  content: { type: "text"; text: string }[];
}>;
