import { post } from "@calcom/lib/fetch-wrapper";
import type { BookingStatus } from "@calcom/prisma/enums";

import type { BookingCreateBody, BookingResponse } from "../types";

// Complete type for the booking response from the API
export type CreateBookingResponse = Omit<BookingResponse, "startTime" | "endTime"> & {
  // Core booking fields (required for SuccessRedirectBookingType)
  uid: string;
  title: string;
  startTime: string; // ISO string from API
  endTime: string; // ISO string from API
  description: string | null;
  location: string | null;

  // User information (required for SuccessRedirectBookingType)
  user: {
    email?: string | null;
    name?: string | null;
    timeZone?: string;
    username?: string | null;
  };
  userPrimaryEmail?: string;
  userId?: number;

  // Attendees (required for SuccessRedirectBookingType)
  attendees: Array<{
    email: string;
    name: string;
    timeZone: string;
    locale?: string | null;
  }>;

  // Form responses (required for SuccessRedirectBookingType)
  responses: Record<string, unknown> | null;

  // Additional booking fields
  eventTypeId?: number | null;
  status?: BookingStatus;

  // Payment related
  paymentRequired: boolean;
  paymentUid?: string;
  paymentId?: number;

  // Additional fields
  isDryRun?: boolean;
  seatReferenceUid?: string | null;
  videoCallUrl?: string;
  references?: Array<{ type: string; uid: string; meetingId?: string | null; meetingUrl?: string | null }>;
  message?: string;
  luckyUsers?: number[];
  troubleshooterData?: unknown;
};

export const createBooking = async (data: BookingCreateBody): Promise<CreateBookingResponse> => {
  const response = await post<BookingCreateBody, CreateBookingResponse>("/api/book/event", data);
  return response;
};
