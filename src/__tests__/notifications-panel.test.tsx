/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { NotificationsPanel } from '@/components/features/notifications-panel';

describe('NotificationsPanel', () => {
  it('shows the error, not a spinner that never stops, when the list fails to load', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: { message: 'Session expired' } }) })) as never;
    const { container } = render(<NotificationsPanel projectId="p1" />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Session expired');
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});
