// Predefined reminder offsets, in minutes before the event
import {CalendarTranslations} from '@/types';
import {interpolate} from '@/core/format';
import {subMinutes, format} from 'date-fns';

export const REMINDER_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 60, 120, 1440, 2880, 10080];
export const DEFAULT_REMINDER_TEMPLATE = '{title} {inMinutes}';

/** Localized reminder label: "30 minutes before", "1 day before"… */
export const reminderLabel = (minutes: number, t: CalendarTranslations): string => {
	if (minutes === 0) return t.reminderAtTime;
	if (minutes === 10080) return t.reminderWeek;
	if (minutes === 1440) return t.reminderDay;
	if (minutes % 1440 === 0) return interpolate(t.reminderDays, {n: minutes / 1440});
	if (minutes === 60) return t.reminderHour;
	if (minutes % 60 === 0) return interpolate(t.reminderHours, {n: minutes / 60});
	return interpolate(t.reminderMinutes, {n: minutes});
};

export const reminderText = (template: string, title: string, date: Date, minutes: number) => {
	const variables = {
		time: format(subMinutes(date, minutes), 'h:mm'),
		minutes,
		title,
		inMinutes: minutes === 0 ? 'now' : minutes === 1 ? 'in 1 minute' : `in ${minutes} minutes`,
	};

	return interpolate(template, variables);
}