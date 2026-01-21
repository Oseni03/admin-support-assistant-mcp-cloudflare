import { z } from "zod";

// ── Event Schemas ──────────────────────────────────────────────────────

export const CreateEventSchema = z.object({
  summary: z.string().describe("Event title/summary"),
  description: z.string().optional().describe("Event description"),
  location: z.string().optional().describe("Event location"),
  startDateTime: z.string().describe("Start time in ISO 8601 format (e.g., 2024-01-15T10:00:00-08:00)"),
  endDateTime: z.string().describe("End time in ISO 8601 format"),
  timeZone: z.string().optional().describe("Time zone (e.g., America/Los_Angeles)"),
  attendees: z.array(z.string().email()).optional().describe("List of attendee email addresses"),
  calendarId: z.string().default("primary").describe("Calendar ID (default: primary)"),
});

export const UpdateEventSchema = z.object({
  eventId: z.string().describe("Event ID to update"),
  summary: z.string().optional().describe("New event title/summary"),
  description: z.string().optional().describe("New event description"),
  location: z.string().optional().describe("New event location"),
  startDateTime: z.string().optional().describe("New start time in ISO 8601 format"),
  endDateTime: z.string().optional().describe("New end time in ISO 8601 format"),
  timeZone: z.string().optional().describe("Time zone"),
  attendees: z.array(z.string().email()).optional().describe("Updated list of attendees"),
  calendarId: z.string().default("primary").describe("Calendar ID"),
});

export const DeleteEventSchema = z.object({
  eventId: z.string().describe("Event ID to delete"),
  calendarId: z.string().default("primary").describe("Calendar ID"),
  sendUpdates: z.enum(["all", "externalOnly", "none"]).default("all").describe("Whether to send cancellation emails"),
});

export const GetEventSchema = z.object({
  eventId: z.string().describe("Event ID to retrieve"),
  calendarId: z.string().default("primary").describe("Calendar ID"),
});

export const ListEventsSchema = z.object({
  calendarId: z.string().default("primary").describe("Calendar ID"),
  timeMin: z.string().optional().describe("Lower bound for event start time (ISO 8601)"),
  timeMax: z.string().optional().describe("Upper bound for event start time (ISO 8601)"),
  maxResults: z.number().min(1).max(250).default(10).describe("Maximum number of events to return"),
  query: z.string().optional().describe("Free text search terms"),
  singleEvents: z.boolean().default(true).describe("Expand recurring events into instances"),
  orderBy: z.enum(["startTime", "updated"]).default("startTime").describe("Order of events"),
});

// ── Calendar Schemas ───────────────────────────────────────────────────

export const ListCalendarsSchema = z.object({
  maxResults: z.number().min(1).max(250).default(100).describe("Maximum number of calendars to return"),
  showHidden: z.boolean().default(false).describe("Include hidden calendars"),
});

export const CreateCalendarSchema = z.object({
  summary: z.string().describe("Calendar title"),
  description: z.string().optional().describe("Calendar description"),
  timeZone: z.string().optional().describe("Calendar time zone"),
});

export const UpdateCalendarSchema = z.object({
  calendarId: z.string().describe("Calendar ID to update"),
  summary: z.string().optional().describe("New calendar title"),
  description: z.string().optional().describe("New calendar description"),
  timeZone: z.string().optional().describe("New time zone"),
});

export const DeleteCalendarSchema = z.object({
  calendarId: z.string().describe("Calendar ID to delete"),
});

// ── Quick Add Schema ───────────────────────────────────────────────────

export const QuickAddEventSchema = z.object({
  text: z.string().describe("Natural language event description (e.g., 'Dinner with Alice tomorrow at 7pm')"),
  calendarId: z.string().default("primary").describe("Calendar ID"),
});

// ── Freebusy Schema ────────────────────────────────────────────────────

export const FreeBusyQuerySchema = z.object({
  timeMin: z.string().describe("Start time for query (ISO 8601)"),
  timeMax: z.string().describe("End time for query (ISO 8601)"),
  items: z
    .array(
      z.object({
        id: z.string().describe("Calendar ID to check"),
      }),
    )
    .describe("List of calendars to query"),
  timeZone: z.string().optional().describe("Time zone for response"),
});
