import { DriveContext } from "./context";

export type DriveTool<T> = (
  ctx: DriveContext,
  args: T,
) => Promise<{
  content: { type: "text"; text: string }[];
}>;
