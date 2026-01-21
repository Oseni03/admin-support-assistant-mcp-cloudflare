import { z } from "zod";
import { CalendarTool } from "./types";
import { FreeBusyQuerySchema } from "./schemas";

export const freeBusyQuery: CalendarTool<z.infer<typeof FreeBusyQuerySchema>> = async ({ calendar }, args) => {
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: args.timeMin,
      timeMax: args.timeMax,
      items: args.items,
      timeZone: args.timeZone,
    },
  });

  const calendars = Object.entries(response.data.calendars || {}).map(([calendarId, data]) => ({
    calendarId,
    busy: data.busy?.map((period) => ({
      start: period.start,
      end: period.end,
    })),
    errors: data.errors,
  }));

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            timeMin: args.timeMin,
            timeMax: args.timeMax,
            calendars,
          },
          null,
          2,
        ),
      },
    ],
  };
};
