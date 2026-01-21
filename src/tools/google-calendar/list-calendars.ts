import { z } from "zod";
import { CalendarTool } from "./types";
import { ListCalendarsSchema } from "./schemas";

export const listCalendars: CalendarTool<z.infer<typeof ListCalendarsSchema>> = async ({ calendar }, args) => {
  const response = await calendar.calendarList.list({
    maxResults: args.maxResults,
    showHidden: args.showHidden,
  });

  const calendars =
    response.data.items?.map((cal) => ({
      id: cal.id,
      summary: cal.summary,
      description: cal.description,
      timeZone: cal.timeZone,
      primary: cal.primary,
      backgroundColor: cal.backgroundColor,
      foregroundColor: cal.foregroundColor,
      accessRole: cal.accessRole,
    })) || [];

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            totalCalendars: calendars.length,
            calendars,
          },
          null,
          2,
        ),
      },
    ],
  };
};
