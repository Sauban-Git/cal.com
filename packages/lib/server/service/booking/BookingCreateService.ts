import type getBookingDataSchema from "@calcom/features/bookings/lib/getBookingDataSchema";
import type getBookingDataSchemaForApi from "@calcom/features/bookings/lib/getBookingDataSchemaForApi";
import type { HandleNewBookingService } from "@calcom/features/bookings/lib/handleNewBooking";
import type { BookingResponse } from "@calcom/features/bookings/types";
import handleInstantMeeting from "@calcom/features/instant-meeting/handleInstantMeeting";
import { SchedulingType } from "@calcom/prisma/client";
import type { AppsStatus } from "@calcom/types/Calendar";

import type { CreateBookingInput, CreateInstantBookingInput } from "./BookingCreateTypes";

// Type for schema getter functions used in booking validation
// Properly typed to match what HandleNewBookingService expects
type BookingDataSchemaGetter = typeof getBookingDataSchema | typeof getBookingDataSchemaForApi;

// Type for booking data that comes from external sources (API, web)
type ExternalBookingData = Record<string, unknown>;

// handleNewBookingService historically expects loose typing
// We maintain type safety at our boundary and cast where necessary
type HandleNewBookingInput = Record<string, unknown>;

// Type for recurring booking handler input - copied from handleNewRecurringBooking
type PlatformParams = {
  platformClientId?: string;
  platformCancelUrl?: string;
  platformBookingUrl?: string;
  platformRescheduleUrl?: string;
  platformBookingLocation?: string;
  areCalendarEventsEnabled?: boolean;
};

type RecurringBookingHandlerInput = {
  bookingData: Record<string, any>[];
  userId?: number;
  // These used to come from headers but now we're passing them as params
  hostname?: string;
  forcedSlug?: string;
  noEmail?: boolean;
} & PlatformParams;

// Minimal NextApiRequest shape needed for instant meetings
type InstantMeetingRequest = {
  body: Record<string, unknown>;
  query: Record<string, string | string[]>;
  cookies: Record<string, string>;
  headers?: Record<string, string | string[]>;
  method?: string;
} & Record<string, unknown>;

export interface IBookingCreateServiceDependencies {
  handleNewBookingService: HandleNewBookingService;
}

export class BookingCreateService {
  constructor(private readonly dependencies: IBookingCreateServiceDependencies) {}

  async createBooking(input: { bookingData: ExternalBookingData; schemaGetter?: BookingDataSchemaGetter }) {
    const { bookingData, schemaGetter } = input;

    // handleNewBookingService requires specific shape - we adapt our types here
    // The service internally expects Record<string, any> for legacy reasons
    // We maintain type safety at our boundary and use assertion for compatibility
    const handlerInput = { bookingData } as Parameters<HandleNewBookingService["handle"]>[0];
    return this.dependencies.handleNewBookingService.handle(handlerInput, schemaGetter);
  }

  async createRecurringBooking(input: RecurringBookingHandlerInput): Promise<BookingResponse[]> {
    const data = input.bookingData;
    const createdBookings: BookingResponse[] = [];
    const allRecurringDates: { start: string | undefined; end: string | undefined }[] = data.map(
      (booking) => {
        return { start: booking.start, end: booking.end };
      }
    );
    const appsStatus: AppsStatus[] | undefined = undefined;

    const numSlotsToCheckForAvailability = 1;

    let thirdPartyRecurringEventId = null;

    // for round robin, the first slot needs to be handled first to define the lucky user
    const firstBooking = data[0];
    const isRoundRobin = firstBooking.schedulingType === SchedulingType.ROUND_ROBIN;

    let luckyUsers = undefined;

    const handleBookingMeta = {
      userId: input.userId,
      platformClientId: input.platformClientId,
      platformRescheduleUrl: input.platformRescheduleUrl,
      platformCancelUrl: input.platformCancelUrl,
      platformBookingUrl: input.platformBookingUrl,
      platformBookingLocation: input.platformBookingLocation,
      areCalendarEventsEnabled: input.areCalendarEventsEnabled,
    };

    if (isRoundRobin) {
      const recurringEventData = {
        ...firstBooking,
        appsStatus,
        allRecurringDates,
        isFirstRecurringSlot: true,
        thirdPartyRecurringEventId,
        numSlotsToCheckForAvailability,
        currentRecurringIndex: 0,
        noEmail: input.noEmail !== undefined ? input.noEmail : false,
      };

      const firstBookingResult = await this.createBooking({
        bookingData: {
          bookingData: recurringEventData,
          hostname: input.hostname || "",
          forcedSlug: input.forcedSlug as string | undefined,
          ...handleBookingMeta,
        },
      });
      luckyUsers = (firstBookingResult as any).luckyUsers;
    }

    for (let key = isRoundRobin ? 1 : 0; key < data.length; key++) {
      const booking = data[key];
      // Disable AppStatus in Recurring Booking Email as it requires us to iterate backwards to be able to compute the AppsStatus for all the bookings except the very first slot and then send that slot's email with statuses
      // It is also doubtful that how useful is to have the AppsStatus of all the bookings in the email.
      // It is more important to iterate forward and check for conflicts for only first few bookings defined by 'numSlotsToCheckForAvailability'
      // if (key === 0) {
      //   const calcAppsStatus: { [key: string]: AppsStatus } = createdBookings
      //     .flatMap((book) => (book.appsStatus !== undefined ? book.appsStatus : []))
      //     .reduce((prev, curr) => {
      //       if (prev[curr.type]) {
      //         prev[curr.type].failures += curr.failures;
      //         prev[curr.type].success += curr.success;
      //       } else {
      //         prev[curr.type] = curr;
      //       }
      //       return prev;
      //     }, {} as { [key: string]: AppsStatus });
      //   appsStatus = Object.values(calcAppsStatus);
      // }

      const recurringEventData = {
        ...booking,
        appsStatus,
        allRecurringDates,
        isFirstRecurringSlot: key == 0,
        thirdPartyRecurringEventId,
        numSlotsToCheckForAvailability,
        currentRecurringIndex: key,
        noEmail: input.noEmail !== undefined ? input.noEmail : key !== 0,
        luckyUsers,
      };

      const promiseEachRecurringBooking = this.createBooking({
        bookingData: {
          hostname: input.hostname || "",
          forcedSlug: input.forcedSlug as string | undefined,
          bookingData: recurringEventData,
          ...handleBookingMeta,
        },
      });

      const eachRecurringBooking = await promiseEachRecurringBooking;

      createdBookings.push(eachRecurringBooking as BookingResponse);

      if (!thirdPartyRecurringEventId) {
        if ((eachRecurringBooking as any).references && (eachRecurringBooking as any).references.length > 0) {
          for (const reference of (eachRecurringBooking as any).references!) {
            if (reference.thirdPartyRecurringEventId) {
              thirdPartyRecurringEventId = reference.thirdPartyRecurringEventId;
              break;
            }
          }
        }
      }
    }
    return createdBookings;
  }

  async createInstantBooking(input: { bookingData: CreateInstantBookingInput }) {
    const { bookingData } = input;

    // handleInstantMeeting expects a NextApiRequest-like object
    // We create a minimal request object that satisfies the interface
    const instantMeetingRequest: InstantMeetingRequest = {
      body: bookingData as unknown as Record<string, unknown>,
      query: {},
      cookies: {},
      headers: {},
      method: "POST",
    };
    // Use type assertion for compatibility with Next.js types
    return handleInstantMeeting(
      instantMeetingRequest as unknown as Parameters<typeof handleInstantMeeting>[0]
    );
  }

  async createSeatedBooking(input: { bookingData: CreateBookingInput }) {
    const { bookingData } = input;

    // Seated bookings use the same handler as regular bookings
    // We adapt to the expected input format
    const handlerInput = { bookingData: bookingData as unknown as Record<string, unknown> };
    return this.dependencies.handleNewBookingService.handle(
      handlerInput as Parameters<HandleNewBookingService["handle"]>[0]
    );
  }

  // Simple create method that delegates to createBooking
  async create(input: { bookingData: ExternalBookingData; schemaGetter?: BookingDataSchemaGetter }) {
    return this.createBooking(input);
  }
}
