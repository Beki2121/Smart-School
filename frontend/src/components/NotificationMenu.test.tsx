import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NotificationMenu from './NotificationMenu';

const { markRead } = vi.hoisted(() => ({
  markRead: vi.fn(async () => ({
    id: 'notice-1', campusId: 'campus-1', sourceType: 'announcement',
    sourceId: 'announcement-1', titleEn: 'School update', titleAm: 'የትምህርት ቤት ዝማኔ',
    bodyEn: 'A new announcement', bodyAm: '', readAt: '2026-10-30T12:00:00.000Z',
    createdAt: '2026-10-30T11:00:00.000Z'
  }))
}));

vi.mock('../api', () => ({
  api: {
    notifications: () => Promise.resolve({
      unreadCount: 1,
      items: [{
        id: 'notice-1', campusId: 'campus-1', sourceType: 'announcement',
        sourceId: 'announcement-1', titleEn: 'School update', titleAm: 'የትምህርት ቤት ዝማኔ',
        bodyEn: 'A new announcement', bodyAm: '', readAt: null,
        createdAt: '2026-10-30T11:00:00.000Z'
      }]
    }),
    markNotificationRead: markRead
  }
}));

afterEach(() => {
  cleanup();
  markRead.mockClear();
});

describe('notification menu', () => {
  it('loads inbox notifications and marks unread items as read', async () => {
    render(<NotificationMenu t={(key) => key} locale="en" />);

    fireEvent.click(screen.getByRole('button', { name: 'notifications' }));
    expect(await screen.findByText('School update')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /School update/ }));

    expect(markRead).toHaveBeenCalledWith('notice-1');
  });
});
