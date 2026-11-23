import React, {useEffect, useId, useInsertionEffect, useRef, useState} from 'react';
import {useClassNames} from './customize';
import {placeBeside} from './placement';
import {useDialogFocus} from './useDialogFocus';
import {CalendarEvent, CalendarTranslations, EventReminder, EventType, PlaceSearch} from '../types';
import {addDays, format, startOfDay, subMinutes} from 'date-fns';
import {AlignLeft, Bell, Clock, Plus, Trash2, Users, X} from './icons';
import {eventColorStyle} from './eventColor';
import {cx} from '../utils';
import {DiscardPrompt} from './DiscardPrompt';
import {useIsomorphicLayoutEffect} from '../hooks/useIsomorphicLayoutEffect';
import {useDeletionMenu} from './useDeletionMenu';
import {DEFAULT_REMINDER_TEMPLATE, REMINDER_OPTIONS, reminderLabel, reminderText} from '@/reminder-templates';

interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  event?: CalendarEvent | null;
  initialDate?: Date;
  onSave: (event: Partial<CalendarEvent>) => void;
  onDelete?: (eventId: string) => void;
  onDeleteSeries?: (eventId: string) => void;
  calendars?: { id: string; label: string; color?: string }[];
  eventTypes?: EventType[];
  translations: CalendarTranslations;
  /** Opens the create form preset to an all-day event (click in the all-day row). */
  initialAllDay?: boolean;
  /** Fields of a new event already chosen (quick create's "More options"). */
  initialValues?: Partial<CalendarEvent>;
  /** Place suggestions in the Location field (spec §8.7); plain text without. */
  placeSearch?: PlaceSearch;
  /** A card beside what it edits (Classic), a panel docked beside the grid (Focus), or a bottom sheet (Flow). */
  variant?: 'card' | 'panel' | 'sheet';
  /** Told when the form starts or stops having changes (the Focus grid then asks before opening anything else). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Each new value asks to close, as Cancel does (a press on the guarded Focus grid). */
  closeRequest?: number;
}

// Color palette for events
// Each colour with the key of its name (swatches are named by colour, not by hex code).
const COLOR_PALETTE = [
  ['#3b82f6', 'colorBlue'],
  ['#ef4444', 'colorRed'],
  ['#10b981', 'colorEmerald'],
  ['#f59e0b', 'colorAmber'],
  ['#8b5cf6', 'colorViolet'],
  ['#ec4899', 'colorPink'],
  ['#06b6d4', 'colorCyan'],
  ['#84cc16', 'colorLime'],
  ['#f97316', 'colorOrange'],
  ['#6366f1', 'colorIndigo'],
] as const;

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const WIDTH = 440;
const MARGIN = 8;
const LABEL = "ck:flex ck:items-center ck:gap-2 ck:text-sm ck:font-semibold ck:text-muted-foreground ck:sm:min-h-10";
const INPUT = "ck:min-h-10 ck:rounded-lg ck:border ck:border-transparent ck:bg-muted ck:px-3 ck:text-sm ck:text-foreground ck:placeholder:text-muted-foreground ck:transition-colors ck:focus:border-ring ck:focus:bg-background ck:focus:outline-hidden";
const CHIP = "ck:inline-flex ck:items-center ck:gap-1.5 ck:min-h-8 ck:rounded-full ck:bg-muted ck:text-xs ck:font-medium ck:text-foreground";

/** One labelled row of the form (spec §8.5): the label and its icon on the left, the controls on the right. */
const Field: React.FC<{ icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; label: string; htmlFor?: string; labelId?: string; children: React.ReactNode }> = ({ icon: Icon, label, htmlFor, labelId, children }) => {
  const content = <><Icon className="ck:w-4 ck:h-4 ck:shrink-0 ck:opacity-80" aria-hidden="true" />{label}</>;
  return (
    <div className="ck:grid ck:gap-1.5 ck:sm:grid-cols-[7.5rem_minmax(0,1fr)] ck:sm:gap-3 ck:items-start">
      {htmlFor ? <label htmlFor={htmlFor} className={LABEL}>{content}</label> : <span id={labelId} className={LABEL}>{content}</span>}
      <div className="ck:min-w-0">{children}</div>
    </div>
  );
};

export const EventModal: React.FC<EventModalProps> = ({
  isOpen,
  onClose,
  event,
  initialDate,
  onSave,
  onDelete,
  onDeleteSeries,
  calendars,
  translations: t,
  initialAllDay,
  initialValues,
  variant = 'card',
  onDirtyChange,
  closeRequest,
}) => {
  const [mode, setMode] = useState<'edit' | 'create'>('create');
  // Read through a ref so a new initialValues object (an inline prop) does not reset the form.
  const initialValuesRef = useRef(initialValues);
  useInsertionEffect(() => {
    initialValuesRef.current = initialValues;
  });
  // The form as it opened: closing with changes asks first (spec §8.5).
  const openedAs = useRef('');
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const [formData, setFormData] = useState<Partial<CalendarEvent>>({
    title: '',
    description: '',
    location: '',
    start: new Date(),
    end: new Date(),
    allDay: false,
    calendarId: calendars?.[0]?.id,
    type: undefined,
    recurrence: undefined,
    attachments: [],
    reminders: [],
    zones: []
  });

  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [isReminderDropdownOpen, setIsReminderDropdownOpen] = useState(false);
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const id = useId();
  const classNames = useClassNames();
  const card = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setConfirmingDiscard(false);
      // No made-up defaults (spec §8.5): no reminder, no colour (the calendar's colour applies).
      let opened: Partial<CalendarEvent>;
      // What a dirty check compares with: the blank form, so values carried in from the quick card count as input.
      let pristine: Partial<CalendarEvent> | undefined;
      if (event) {
        setMode('edit');
        opened = {
          ...event,
          start: new Date(event.start),
          end: new Date(event.end),
          attachments: event.attachments || [],
          reminders: event.reminders || [],
          zones: event.zones || []
        };
      } else {
        setMode('create');
        const base = initialDate || new Date();
        // All-day: exclusive end at midnight after the day. Otherwise one hour.
        const start = initialAllDay ? startOfDay(base) : base;
        const end = initialAllDay ? addDays(start, 1) : new Date(base.getTime() + 60 * 60 * 1000);

        pristine = {
          title: '',
          description: '',
          location: '',
          start,
          end,
          allDay: !!initialAllDay,
          calendarId: calendars?.[0]?.id,
          attachments: [],
          reminders: [],
          zones: []
        };
        opened = { ...pristine, ...initialValuesRef.current };
      }
      setFormData(opened);
      openedAs.current = JSON.stringify(pristine ?? opened);
    }
  }, [isOpen, event, initialDate, calendars, initialAllDay]);

  const dirty = isOpen && JSON.stringify(formData) !== openedAs.current;
  const requestClose = () => {
    deletion.onCancel();
    if (dirty) setConfirmingDiscard(true);
    else onClose();
  };
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const closeRequestRef = useRef(closeRequest);
  useEffect(() => {
    if (closeRequest === closeRequestRef.current) return;
    closeRequestRef.current = closeRequest;
    setConfirmingDiscard(true);
  }, [closeRequest]);
  // A card beside what it edits (no overlay): the event's block, or the new event's ghost.
  const editedId = event?.id;
  useIsomorphicLayoutEffect(() => {
    const el = card.current;
    if (!isOpen || !el || variant !== 'card') return;
    const root = el.closest('.ck-root');
    const target = editedId === undefined
      ? root?.querySelector('[data-ck-ghost]')
      : [...(root?.querySelectorAll('[data-ck-event-id]') ?? [])].find((node) => node.getAttribute('data-ck-event-id') === editedId);
    const box = target?.getBoundingClientRect();
    const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    setPlace(box && box.width > 0 ? placeBeside(box, { width: Math.min(WIDTH, window.innerWidth - 2 * MARGIN), height: el.offsetHeight }, viewport) : null);
  }, [isOpen, editedId, variant]);

  // The Focus panel sits beside a grid that stays usable: the focus comes back, but Tab is free.
  useDialogFocus(card, { open: isOpen, trap: variant !== 'panel', content: editedId });

  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    onSave({
      ...formData,
      reminders: formData.reminders?.map(r => ({ ...r, label: r.label?.trim() === "" ? undefined : r.label })),
      id: event?.id,
    });
    onClose();
  };

  const handleDeleted = () => {
    if (event?.id && onDelete) {
      onDelete(event.id);
      onClose();
    }
  };

  const handleDeletedSeries = onDeleteSeries ? () => {
    if (event?.id && onDeleteSeries) {
      onDeleteSeries(event.id);
      onClose();
    }
  } : undefined;

  const deletion = useDeletionMenu({ event, onDelete: handleDeleted, onDeleteSeries: handleDeletedSeries });

  const formatDateForInput = (date: Date | undefined) => {
    if (!date) return '';
    return format(date, "yyyy-MM-dd'T'HH:mm");
  };

  const handleDateChange = (value: string) => {
    if (formData.allDay) {
      return;
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) return;
    setFormData(prev => ({    ...prev, start: date, end: date }));
  };

  const addReminder = (minutes: number) => {
    const newReminder: EventReminder = {
      id: Math.random().toString(36).slice(2, 11),
      type: 'notification',
      time: minutes
    };
    setFormData(prev => ({
      ...prev,
      reminders: [...(prev.reminders || []), newReminder]
    }));
    setIsReminderDropdownOpen(false);
  };

  const removeReminder = (id: string) => {
    setFormData(prev => ({
      ...prev,
      reminders: prev.reminders?.filter(r => r.id !== id)
    }));
  };

  const handleRepeatToggle = () => {
    if (formData.recurrence) {
      setFormData(prev => ({ ...prev, recurrence: undefined }));
    } else {
      setFormData(prev => ({ ...prev, recurrence: {
          freq: 'WEEKLY',
          interval: 1,
          byweekday: [formData.start!.getDay()],
        }}));
    }
  }

  const handleZoneToggle = (zone: string) => {
    setFormData(prev => {
      const previousZones = prev.zones || [];
      const zones = previousZones.includes(zone)
        ? previousZones.filter(z => z !== zone)
        : [...previousZones, zone];
      return { ...prev, zones };
    });
  }

  const calendarColor = formData.color || calendars?.find((c) => c.id === formData.calendarId)?.color;

  // ========== EDIT/CREATE MODE ==========
  const renderEditMode = () => (
    <form onSubmit={handleSubmit} className="ck:flex ck:flex-col ck:flex-1 ck:min-h-0 ck:bg-background">
      <div className="ck:flex-1 ck:min-h-0 ck:overflow-y-auto ck:flex ck:flex-col ck:gap-4 ck:px-5 ck:pt-4 ck:pb-5 ck:sm:px-6">
        <div className="ck:flex ck:items-center ck:gap-2">
          <div className="ck:relative">
            <button
              type="button"
              onClick={() => setIsColorPickerOpen(!isColorPickerOpen)}
              className="ck:flex ck:w-8 ck:h-8 ck:items-center ck:justify-center ck:rounded-lg ck:hover:bg-muted"
              aria-label={t.eventColor}
              aria-expanded={isColorPickerOpen}
            >
              <span className="ck-dot ck:w-3.5 ck:h-3.5 ck:rounded-[4px]" style={eventColorStyle(calendarColor)} />
            </button>
            {isColorPickerOpen && (
              <div className="ck:absolute ck:top-full ck:left-0 ck:mt-1 ck:p-2 ck:bg-background ck:border ck:border-border ck:rounded-xl ck:shadow-xl ck:z-50 ck:grid ck:grid-cols-5 ck:gap-1.5">
                {COLOR_PALETTE.map(([color, name]) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={t[name]}
                    aria-pressed={formData.color === color}
                    onClick={() => {
                      setFormData(prev => ({ ...prev, color }));
                      setIsColorPickerOpen(false);
                    }}
                    className={cx("ck:w-7 ck:h-7 ck:rounded-full ck:transition-transform ck:hover:scale-110", formData.color === color && "ck:ring-2 ck:ring-offset-2 ck:ring-offset-background ck:ring-foreground")}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            )}
          </div>
          <h2 id={`${id}-heading`} className="ck:flex-1 ck:text-sm ck:font-semibold ck:text-muted-foreground">
            {mode === 'edit' ? t.editEvent : t.newEvent}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            className="ck:flex ck:w-8 ck:h-8 ck:items-center ck:justify-center ck:rounded-lg ck:text-muted-foreground ck:hover:bg-muted ck:hover:text-foreground"
            aria-label={t.close}
          >
            <X className="ck:w-4 ck:h-4" aria-hidden="true" />
          </button>
        </div>

        <input
          type="text"
          required
          autoFocus
          className="ck:w-full ck:bg-transparent ck:border-0 ck:border-b-2 ck:border-border ck:focus:border-ring ck:px-0.5 ck:py-1.5 ck:font-display ck:text-2xl ck:font-semibold ck:text-foreground ck:placeholder:text-muted-foreground ck:placeholder:font-normal ck:focus:outline-hidden ck:transition-colors"
          value={formData.title}
          onChange={e => setFormData({ ...formData, title: e.target.value })}
          placeholder={t.title}
          aria-label={t.title}
        />

        <Field icon={Clock} label={t.whenLabel} labelId={`${id}-when`}>
          <div role="group" aria-labelledby={`${id}-when`} className="ck:flex ck:flex-col ck:gap-2.5">
            <div className="ck:flex ck:flex-wrap ck:items-center ck:gap-2">
              <label htmlFor={`${id}-end`} className="ck:sr-only">{t.end}</label>
              <input
                id={`${id}-end`}
                type="datetime-local"
                className={cx(INPUT, "ck:tabular-nums")}
                value={formatDateForInput(formData.end)}
                onChange={e => {
                  handleDateChange(e.target.value)
                }}
              />
            </div>
            <div className="ck:flex ck:flex-wrap ck:items-center ck:gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={!!formData.recurrence}
                onClick={handleRepeatToggle}
                className="ck:inline-flex ck:items-center ck:gap-2.5 ck:min-h-10 ck:text-sm ck:font-medium ck:text-foreground"
              >
                <span aria-hidden="true" className={cx("ck:relative ck:inline-flex ck:h-[22px] ck:w-9 ck:shrink-0 ck:rounded-full ck:transition-colors", formData.recurrence ? "ck:bg-primary" : "ck:bg-muted-foreground/30")}>
                  <span className={cx("ck:absolute ck:top-[3px] ck:left-[3px] ck:h-4 ck:w-4 ck:rounded-full ck:bg-background ck:shadow-sm ck:transition-transform", formData.recurrence && "ck:translate-x-[14px]")} />
                </span>
                {t.repeat}
              </button>
            </div>
          </div>
          {formData.recurrence && (
            <div className="ck:flex ck:flex-wrap ck:items-center ck:gap-3">
              {['M', 'Tu', 'W', 'Th', 'F', 'Sa', 'Su'].map((day, index) => {
                const isSelected = formData.recurrence?.byweekday?.includes(index);
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      setFormData(prev => {
                        const byweekday = prev.recurrence?.byweekday || [];
                        if (isSelected) {
                          return { ...prev, recurrence: { ...prev.recurrence, byweekday: byweekday.filter(d => d !== index) } };
                        } else {
                          return { ...prev, recurrence: { ...prev.recurrence, byweekday: [...byweekday, index] } };
                        }
                      });
                    }}
                    className={cx("ck:w-6 ck:h-6 ck:flex ck:items-center ck:justify-center ck:rounded-sm ck:text-sm ck:font-medium", isSelected ? "ck:bg-primary ck:text-background" : "ck:bg-muted ck:text-foreground")}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          )}
        </Field>

        <Field icon={Bell} label={t.reminders} labelId={`${id}-reminders`}>
          <div role="group" aria-labelledby={`${id}-reminders`} className="ck:flex ck:flex-wrap ck:items-center ck:gap-1.5">
            {formData.reminders?.sort((a, b) => b.time - a.time).map(reminder => {
              const template = (reminder.label ?? formData?.description) || DEFAULT_REMINDER_TEMPLATE;
              if (editingReminderId === reminder.id) {
                return (
                  <span key={`reminder-edit-${reminder.id}`} className={cx(CHIP, "ck:pl-3 ck:pr-1")} onClick={() => setEditingReminderId(reminder.id)}>
                    <span className="ck:font-mono ck:text-shadow-xs">{format(subMinutes(formData.end || event?.end || new Date(), reminder.time), 'h:mm')}</span>
                    -
                    {/* From the minutes, in the calendar's language (a stored label may be in another). */}
                    <input autoFocus type="text" value={template} onChange={(e) => {
                      setFormData(prev => ({ ...prev, reminders: prev.reminders?.map(r => r.id === reminder.id ? { ...r, label: e.target.value } : r) }));
                    }} onBlur={() => setEditingReminderId(null)}/>
                    <button
                      type="button"
                      data-ck-small
                      onClick={() => removeReminder(reminder.id)}
                      className="ck:flex ck:w-6 ck:h-6 ck:items-center ck:justify-center ck:rounded-full ck:text-muted-foreground ck:hover:bg-background ck:hover:text-foreground"
                      aria-label={t.removeReminder}
                    >
                      <X className="ck:w-3 ck:h-3" aria-hidden="true" />
                    </button>
                  </span>
                );
              }

              const reminderTextValue = reminderText(template, formData.title || event?.title || '', formData.end || event?.end || new Date(), reminder.time);

              return (<span key={`reminder-pill-${reminder.id}`} className={cx(CHIP, "ck:pl-3 ck:pr-1")} onClick={() => setEditingReminderId(reminder.id)}>
                <span className="ck:font-mono ck:text-shadow-xs">{format(subMinutes(formData.end || event?.end || new Date(), reminder.time), 'k:mm')}</span>
                {' - '}
                {/* From the minutes, in the calendar's language (a stored label may be in another). */}

                {reminderTextValue}
                <button
                  type="button"
                  data-ck-small
                  onClick={() => removeReminder(reminder.id)}
                  className="ck:flex ck:w-6 ck:h-6 ck:items-center ck:justify-center ck:rounded-full ck:text-muted-foreground ck:hover:bg-background ck:hover:text-foreground"
                  aria-label={t.removeReminder}
                >
                  <X className="ck:w-3 ck:h-3" aria-hidden="true" />
                </button>
              </span>)
            })}
            <div className="ck:relative">
              <button
                type="button"
                onClick={() => setIsReminderDropdownOpen(!isReminderDropdownOpen)}
                aria-expanded={isReminderDropdownOpen}
                className="ck:inline-flex ck:items-center ck:gap-1 ck:min-h-8 ck:rounded-full ck:px-3 ck:text-xs ck:font-semibold ck:text-foreground ck:border ck:border-dashed ck:border-border ck:hover:bg-muted"
              >
                <Plus className="ck:w-3.5 ck:h-3.5" aria-hidden="true" />
                {t.addReminder}
              </button>
              {isReminderDropdownOpen && (
                <>
                  <div className="ck:fixed ck:inset-0 ck:z-40" onClick={() => setIsReminderDropdownOpen(false)} />
                  <div className="ck:absolute ck:left-0 ck:top-full ck:mt-1 ck:w-52 ck:bg-background ck:border ck:border-border ck:rounded-xl ck:shadow-xl ck:z-50 ck:p-1 ck:max-h-60 ck:overflow-y-auto">
                    {REMINDER_OPTIONS.map(minutes => (
                      <button
                        key={minutes}
                        type="button"
                        onClick={() => addReminder(minutes)}
                        className="ck:w-full ck:rounded-lg ck:px-3 ck:py-2 ck:text-left ck:text-sm ck:text-foreground ck:hover:bg-muted"
                      >
                        {reminderLabel(minutes, t)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </Field>

        <Field icon={Users} label="Zones" labelId={`${id}-zones`}>
          <div role="group" aria-labelledby={`${id}-zones`} className="ck:flex ck:flex-wrap ck:items-center ck:gap-1.5">
            {['Bedroom', 'Kitchen', 'Noah', 'Piper', 'Outside', 'Playroom'].map(zone => {
              const isSelected = !!formData.zones?.includes(zone);
              return (
                <button
                  key={zone}
                  type="button"
                  onClick={() => handleZoneToggle(zone)}
                  className={cx("ck:w-20 ck:h-8 ck:flex ck:items-center ck:justify-center ck:rounded-full ck:text-sm ck:font-medium", isSelected ? "ck:bg-primary ck:text-background" : "ck:bg-muted ck:text-foreground")}
                >
                  {zone}
                </button>
              );
            })}
          </div>
        </Field>
        <Field icon={AlignLeft} label="Reminder Template" htmlFor={`${id}-description`}>
          <textarea
            id={`${id}-description`}
            rows={3}
            className={cx(INPUT, "ck:w-full ck:py-2.5 ck:resize-y")}
            placeholder={t.addNotes}
            value={formData.description ?? ''}
            onChange={e => setFormData({ ...formData, description: e.target.value === "" ? undefined : e.target.value })}
          />
          <span className="ck:text-sm">{`Allows template replacement with {title}, {time}, {minutes}, {inMinutes}`}</span>
        </Field>
      </div>

      <div className="ck:shrink-0 ck:flex ck:items-center ck:gap-2 ck:border-t ck:border-border ck:px-5 ck:py-3 ck:sm:px-6">
        {confirmingDiscard ? (
          <DiscardPrompt translations={t} onKeep={() => setConfirmingDiscard(false)} onDiscard={onClose} />
        ) : (
          <>
            {mode === 'edit' && deletion.inMenu ? (<>
              <button
                type="button"
                onClick={deletion.onDelete}
                className="ck:inline-flex ck:items-center ck:gap-1.5 ck:min-h-10 ck:rounded-lg ck:px-3 ck:text-sm ck:font-semibold ck:text-destructive ck:hover:bg-destructive/10"
              >
                <Trash2 className="ck:w-4 ck:h-4" aria-hidden="true" />
                {t.deleteOccurrence}
              </button>
              <button
                type="button"
                onClick={deletion.onDeleteSeries}
                className="ck:inline-flex ck:items-center ck:gap-1.5 ck:min-h-10 ck:rounded-lg ck:px-3 ck:text-sm ck:font-semibold ck:text-destructive ck:hover:bg-destructive/10"
              >
                <Trash2 className="ck:w-4 ck:h-4" aria-hidden="true" />
                {t.deleteSeries}
              </button>
            </>) : (
              <button
                type="button"
                onClick={deletion.onDeleteOrMenu}
                className="ck:inline-flex ck:items-center ck:gap-1.5 ck:min-h-10 ck:rounded-lg ck:px-3 ck:text-sm ck:font-semibold ck:text-destructive ck:hover:bg-destructive/10"
              >
                <Trash2 className="ck:w-4 ck:h-4" aria-hidden="true" />
                {t.delete}
              </button>
            )}
            <span className="ck:flex-1" />
            <button
              type="button"
              onClick={requestClose}
              className="ck:min-h-10 ck:rounded-lg ck:px-4 ck:text-sm ck:font-semibold ck:text-foreground ck:hover:bg-muted"
            >
              {t.cancel}
            </button>
            {!deletion.inMenu && (<button
              type="submit"
              className="ck:min-h-10 ck:rounded-lg ck:bg-primary ck:px-5 ck:text-sm ck:font-semibold ck:text-primary-foreground ck:hover:bg-primary/90"
            >
              {mode === 'edit' ? t.saveChanges : t.createEvent}
            </button>)}
          </>
        )}
      </div>
    </form>
  );

  if (!isOpen) return null;
  if (variant === 'panel') {
    // Focus: docked in the calendar's row, beside the grid, which stays usable (no overlay).
    return (
      <div ref={card} data-ck-panel role="dialog" aria-labelledby={`${id}-heading`} className={cx("ck:flex ck:h-full ck:w-[440px] ck:max-w-full ck:shrink-0 ck:flex-col ck:border-l ck:border-border ck:bg-background ck:animate-fade-in", classNames.dialog)}>
        {renderEditMode()}
      </div>
    );
  }
  if (variant === 'sheet') {
    // Flow: a sheet from the bottom of the calendar, over a light scrim (nothing blurred).
    return (
      <>
        <div data-ck-backdrop className="ck:absolute ck:inset-0 ck:z-40 ck:bg-black/20 ck:animate-fade-in" onClick={requestClose} />
        <div ref={card} data-ck-sheet role="dialog" aria-modal="true" aria-labelledby={`${id}-heading`} className={cx("ck:absolute ck:inset-x-0 ck:bottom-0 ck:z-50 ck:mx-auto ck:flex ck:max-h-[85%] ck:w-full ck:max-w-[720px] ck:flex-col ck:overflow-hidden ck:rounded-t-3xl ck:bg-background ck:shadow-[0_-20px_50px_-20px_rgb(0_0_0/0.4)] ck:animate-rise-in", classNames.dialog)}>
          <span aria-hidden="true" className="ck:mx-auto ck:mt-2.5 ck:h-1.5 ck:w-11 ck:shrink-0 ck:rounded-full ck:bg-muted-foreground/30" />
          {renderEditMode()}
        </div>
      </>
    );
  }
  // No taller than the room below its top: the form scrolls inside, Save stays in the window.
  const at = place ?? { left: Math.max(MARGIN, (window.innerWidth - WIDTH) / 2), top: 80 };
  return (
    <>
      <div data-ck-backdrop className="ck:fixed ck:inset-0 ck:z-40" onClick={requestClose} />
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-heading`}
        className={cx("ck:fixed ck:z-50 ck:flex ck:flex-col ck:overflow-hidden ck:rounded-2xl ck:border ck:border-border ck:bg-background ck:shadow-[0_24px_56px_-20px_rgb(0_0_0/0.4),0_2px_8px_-2px_rgb(0_0_0/0.12)] ck:animate-pop-in", classNames.dialog)}
        style={{ ...at, width: WIDTH, maxWidth: `calc(100vw - ${2 * MARGIN}px)`, maxHeight: window.innerHeight - at.top - MARGIN }}
      >
        {renderEditMode()}
      </div>
    </>
  );
};
