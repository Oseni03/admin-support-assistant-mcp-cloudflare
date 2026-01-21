import { CalendarContext } from "./context";

export type CalendarTool<T> = (
  ctx: CalendarContext,
  args: T,
) => Promise<{
  content: { type: "text"; text: string }[];
}>;
