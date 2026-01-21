import { z } from "zod";
import { CalendarTool } from "./types";
import { DeleteEventSchema } from "./schemas";

export const deleteEvent: CalendarTool<z.infer<typeof DeleteEventSchema>> = async ({ calendar }, args) => {
  await calendar.events.delete({
    calendarId: args.calendarId,
    eventId: args.eventId,
    sendUpdates: args.sendUpdates,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: `Event ${args.eventId} deleted successfully`,
      },
    ],
  };
};
