import { z } from "zod";
import { CalendarTool } from "./types";
import { CreateEventSchema } from "./schemas";

export const createEvent: CalendarTool<z.infer<typeof CreateEventSchema>> = async ({ calendar }, args) => {
  const event = {
    summary: args.summary,
    description: args.description,
    location: args.location,
    start: {
      dateTime: args.startDateTime,
      timeZone: args.timeZone,
    },
    end: {
      dateTime: args.endDateTime,
      timeZone: args.timeZone,
    },
    attendees: args.attendees?.map((email) => ({ email })),
  };

  const response = await calendar.events.insert({
    calendarId: args.calendarId,
    requestBody: event,
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
            htmlLink: response.data.htmlLink,
            summary: response.data.summary,
            start: response.data.start,
            end: response.data.end,
          },
          null,
          2,
        ),
      },
    ],
  };
};
