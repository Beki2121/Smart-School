import { z } from 'zod';

export const campusAnnouncementSchema = z.object({
  titleEn: z.string().trim().min(2).max(180),
  titleAm: z.string().trim().min(2).max(180),
  bodyEn: z.string().trim().min(1).max(10000),
  bodyAm: z.string().trim().min(1).max(10000)
});
export const campusEventSchema = z.object({
  titleEn: z.string().trim().min(2).max(180),
  titleAm: z.string().trim().min(2).max(180),
  descriptionEn: z.string().trim().max(5000).optional().default(''),
  descriptionAm: z.string().trim().max(5000).optional().default(''),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  startsAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional().default(null),
  endsAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional().default(null),
  location: z.string().trim().max(180).optional().default('')
}).superRefine((event, context) => {
  if (event.startsOn > event.endsOn) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Event end date must not be before the start date.', path: ['endsOn'] });
  }
  if ((event.startsAt && !event.endsAt) || (!event.startsAt && event.endsAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide both start and end times, or neither.', path: ['endsAt'] });
  } else if (event.startsOn === event.endsOn && event.startsAt && event.endsAt && event.startsAt >= event.endsAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Event end time must be after the start time.', path: ['endsAt'] });
  }
});
export const eventRangeSchema = z.object({
  from: z.string().date(),
  to: z.string().date()
}).superRefine((range, context) => {
  if (range.from > range.to) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Start date must not be after end date.', path: ['from'] });
  }
});
