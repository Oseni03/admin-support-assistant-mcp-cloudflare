import { createEvent } from "./create-event";
import { updateEvent } from "./update-event";
import { deleteEvent } from "./delete-event";
import { getEvent } from "./get-event";
import { listEvents } from "./list-events";
import { listCalendars } from "./list-calendars";
import { quickAddEvent } from "./quick-add-event";
import { freeBusyQuery } from "./freebusy-query";
import {
  CreateEventSchema,
  UpdateEventSchema,
  DeleteEventSchema,
  GetEventSchema,
  ListEventsSchema,
  ListCalendarsSchema,
  QuickAddEventSchema,
  FreeBusyQuerySchema,
} from "./schemas";

// ── Export context creator ─────────────────────────────────────────────
export { createCalendarContext } from "./context";

// ── Export the complete tool registry ──────────────────────────────────
export const calendarTools = {
  create_event: {
    schema: CreateEventSchema,
    handler: createEvent,
    description: "Create a new calendar event with specified details",
  },
  update_event: {
    schema: UpdateEventSchema,
    handler: updateEvent,
    description: "Update an existing calendar event",
  },
  delete_event: {
    schema: DeleteEventSchema,
    handler: deleteEvent,
    description: "Delete a calendar event",
  },
  get_event: {
    schema: GetEventSchema,
    handler: getEvent,
    description: "Get detailed information about a specific event",
  },
  list_events: {
    schema: ListEventsSchema,
    handler: listEvents,
    description: "List calendar events with optional filtering",
  },
  list_calendars: {
    schema: ListCalendarsSchema,
    handler: listCalendars,
    description: "List all available calendars",
  },
  quick_add_event: {
    schema: QuickAddEventSchema,
    handler: quickAddEvent,
    description: "Quickly add an event using natural language (e.g., 'Dinner tomorrow at 7pm')",
  },
  freebusy_query: {
    schema: FreeBusyQuerySchema,
    handler: freeBusyQuery,
    description: "Query free/busy information for calendars",
  },
} as const;
