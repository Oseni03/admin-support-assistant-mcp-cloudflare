import { z } from "zod";
import { CalendarTool } from "./types";
import { ListEventsSchema } from "./schemas";

export const listEvents: CalendarTool<z.infer<typeof ListEventsSchema>> = async ({ calendar }, args) => {
  const response = await calendar.events.list({
    calendarId: args.calendarId,
    timeMin: args.timeMin,
    timeMax: args.timeMax,
    maxResults: args.maxResults,
    singleEvents: args.singleEvents,
    orderBy: args.orderBy,
    q: args.query,
  });

  const events =
    response.data.items?.map((event) => ({
      id: event.id,
      summary: event.summary,
      description: event.description,
      location: event.location,
      start: event.start,
      end: event.end,
      attendees: event.attendees?.map((a) => ({
        email: a.email,
        responseStatus: a.responseStatus,
      })),
      htmlLink: event.htmlLink,
      status: event.status,
    })) || [];

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            totalEvents: events.length,
            events,
          },
          null,
          2,
        ),
      },
    ],
  };
};
