export type QueueView = 'unread' | 'reading' | 'dueThisWeek' | 'recentlyFinished';

export const QUEUE_VIEWS: { id: QueueView; label: string }[] = [
  { id: 'unread', label: 'Unread' },
  { id: 'reading', label: 'Reading' },
  { id: 'dueThisWeek', label: 'Due this week' },
  { id: 'recentlyFinished', label: 'Recently finished' },
];
