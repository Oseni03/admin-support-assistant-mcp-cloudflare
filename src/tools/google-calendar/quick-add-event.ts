import { z } from "zod";
import { CalendarTool } from "./types";
import { QuickAddEventSchema } from "./schemas";

export const quickAddEvent: CalendarTool<z.infer<typeof QuickAddEventSchema>> = async ({ calendar }, args) => {
  const response = await calendar.events.quickAdd({
    calendarId: args.calendarId,
    text: args.text,
    sendUpdates: "all",
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            eventId: response.data.id,
            summary: response.data.summary,
            start: response.data.start,
            end: response.data.end,
            htmlLink: response.data.htmlLink,
          },
          null,
          2,
        ),
      },
    ],
  };
};
