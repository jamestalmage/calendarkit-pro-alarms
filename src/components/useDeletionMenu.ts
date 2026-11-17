import {useState, useCallback} from 'react';
import {CalendarEvent} from '../types';

export type SeriesAwareDeletionProps = {
	event?: CalendarEvent | null;
	onDelete?: () => void;
	onDeleteSeries?: () => void;
};

export const useDeletionMenu = ({ event, onDelete: originalOnDelete, onDeleteSeries: originalOnDeleteSeries }: SeriesAwareDeletionProps) => {
	const hasSeries = !!event?.recurrence && !!originalOnDelete;
	const [inMenu, setInMenu] = useState(false);

	const onDelete = useCallback(() => {
		if (!originalOnDelete) return;
		setInMenu(false);
		originalOnDelete();
	}, [originalOnDelete, setInMenu]);

	const onDeleteSeries = useCallback(() => {
		setInMenu(false);
		if (originalOnDeleteSeries) {
			originalOnDeleteSeries();
		}
	}, [originalOnDeleteSeries, setInMenu]);

	const onCancel = useCallback(() => {
		setInMenu(false);
	}, [setInMenu]);

	const onDeleteOrMenu = useCallback(() => {
		if (hasSeries) {
			setInMenu(true);
		} else if (originalOnDelete) {
			originalOnDelete();
		}
	}, [hasSeries, originalOnDelete, setInMenu]);

	return {
		inMenu,
		hasSeries,
		onDelete,
		onDeleteSeries,
		onCancel,
		onDeleteOrMenu,
	};
}
