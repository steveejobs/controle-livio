BEGIN;

ALTER TABLE public.calendar_events
  ADD COLUMN reminder_minutes INTEGER[] NOT NULL DEFAULT ARRAY[60, 30, 10],
  ADD CONSTRAINT calendar_events_reminder_minutes_check CHECK (
    cardinality(reminder_minutes) <= 8
    AND 0 < ALL(reminder_minutes)
    AND 10080 >= ALL(reminder_minutes)
    AND array_position(reminder_minutes, NULL) IS NULL
  );

-- Preserve custom intervals and an explicitly empty selection from existing events.
UPDATE public.calendar_events event
SET reminder_minutes = COALESCE((
  SELECT array_agg(DISTINCT (notification.metadata->>'minutesBefore')::integer
    ORDER BY (notification.metadata->>'minutesBefore')::integer DESC)
  FROM public.notifications notification
  WHERE notification.organization_id = event.organization_id
    AND notification.metadata->>'source' = 'HEARING_REMINDER'
    AND notification.metadata->>'eventId' = event.id::text
    AND notification.metadata->>'minutesBefore' ~ '^[0-9]{1,5}$'
    AND (notification.metadata->>'minutesBefore')::integer BETWEEN 1 AND 10080
), ARRAY[]::integer[])
WHERE event.type = 'HEARING';

COMMIT;
