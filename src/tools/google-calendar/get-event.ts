import { z } from "zod";
import { CalendarTool } from "./types";
import { GetEventSchema } from "./schemas";

export const getEvent: CalendarTool<z.infer<typeof GetEventSchema>> = async ({ calendar }, args) => {
  const response = await calendar.events.get({
    calendarId: args.calendarId,
    eventId: args.eventId,
  });

  const event = {
    id: response.data.id,
    summary: response.data.summary,
    description: response.data.description,
    location: response.data.location,
    start: response.data.start,
    end: response.data.end,
    attendees: response.data.attendees?.map((a) => ({
      email: a.email,
      responseStatus: a.responseStatus,
      displayName: a.displayName,
    })),
    htmlLink: response.data.htmlLink,
    created: response.data.created,
    updated: response.data.updated,
    status: response.data.status,
    organizer: response.data.organizer,
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(event, null, 2),
      },
    ],
  };
};
