import { z } from "zod";
import { CalendarTool } from "./types";
import { UpdateEventSchema } from "./schemas";

export const updateEvent: CalendarTool<z.infer<typeof UpdateEventSchema>> = async ({ calendar }, args) => {
  // First, get the existing event
  const existingEvent = await calendar.events.get({
    calendarId: args.calendarId,
    eventId: args.eventId,
  });

  // Build update object with only provided fields
  const updates: any = {
    ...existingEvent.data,
  };

  if (args.summary !== undefined) updates.summary = args.summary;
  if (args.description !== undefined) updates.description = args.description;
  if (args.location !== undefined) updates.location = args.location;

  if (args.startDateTime !== undefined) {
    updates.start = {
      dateTime: args.startDateTime,
      timeZone: args.timeZone || updates.start?.timeZone,
    };
  }

  if (args.endDateTime !== undefined) {
    updates.end = {
      dateTime: args.endDateTime,
      timeZone: args.timeZone || updates.end?.timeZone,
    };
  }

  if (args.attendees !== undefined) {
    updates.attendees = args.attendees.map((email) => ({ email }));
  }

  const response = await calendar.events.update({
    calendarId: args.calendarId,
    eventId: args.eventId,
    requestBody: updates,
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
            updated: response.data.updated,
          },
          null,
          2,
        ),
      },
    ],
  };
};
