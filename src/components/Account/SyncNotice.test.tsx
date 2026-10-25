import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ status: 'off' as string }));
vi.mock('../../lib/sync/prefSync', () => ({ useSyncStatus: () => h.status }));

import SyncNotice from './SyncNotice';

beforeEach(() => (h.status = 'off'));

describe('SyncNotice (kill switch)', () => {
  it.each(['off', 'connecting', 'live', 'error'])('shows nothing while %s', (s) => {
    h.status = s;
    const { container } = render(<SyncNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('while paused: says so, and can be dismissed', () => {
    h.status = 'paused';
    render(<SyncNotice />);
    expect(screen.getByRole('status')).toHaveTextContent(/Cloud sync is paused/);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
