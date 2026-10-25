// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../../lib/firebase/auth';

const h = vi.hoisted(() => ({
  auth: {} as AuthState,
  signIn: vi.fn(),
  signOut: vi.fn(async () => true),
  clear: vi.fn(),
}));
vi.mock('../../lib/firebase/auth', () => ({
  useAuth: () => h.auth,
  signInWithGoogle: h.signIn,
  signOutUser: h.signOut,
  clearAuthError: h.clear,
}));

import AccountButton from './AccountButton';
import AccountSection from './AccountSection';
import SignOutDialog from './SignOutDialog';
import Settings from '../Settings/Settings';

const ada = {
  uid: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  photoURL: null,
};
afterEach(cleanup);
const state = (p: Partial<AuthState> = {}): AuthState => ({
  status: 'guest',
  user: null,
  error: null,
  available: true,
  signingIn: false,
  ...p,
});
const signedIn = (p: Partial<AuthState> = {}) =>
  state({ status: 'user', user: ada, ...p });

beforeEach(() => {
  h.auth = state();
  h.signIn.mockClear();
  h.signOut.mockReset().mockResolvedValue(true);
  h.clear.mockClear();
  localStorage.clear();
});

// P2-T2
describe('AccountButton', () => {
  it('shows nothing while a saved session is being restored (no flicker)', () => {
    h.auth = state({ status: 'loading' });
    const { container } = render(<AccountButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing when accounts are not configured', () => {
    h.auth = state({ available: false });
    const { container } = render(<AccountButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('guest: a "Sign in" button that starts the sign-in', () => {
    render(<AccountButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(h.signIn).toHaveBeenCalledTimes(1);
  });

  it('guest: the button is disabled while a sign-in is open', () => {
    h.auth = state({ signingIn: true });
    render(<AccountButton />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('guest: a failed sign-in is explained next to the button', () => {
    h.auth = state({
      error: "Couldn't reach Google. Check your connection and try again.",
    });
    render(<AccountButton />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Couldn.t reach Google/,
    );
  });

  // P2-T8
  it('phone header: guests get no button here (they sign in from Settings)', () => {
    const { container } = render(<AccountButton compact />);
    expect(container).toBeEmptyDOMElement();
  });

  it('phone header: a signed-in person still gets the avatar', () => {
    h.auth = signedIn();
    render(<AccountButton compact />);
    expect(
      screen.getByRole('button', { name: /ada@example.com/ }),
    ).toBeInTheDocument();
  });

  it('signed in: avatar shows the initial when there is no photo, the photo when there is one', () => {
    h.auth = signedIn();
    const { unmount } = render(<AccountButton />);
    expect(
      screen.getByRole('button', { name: /Account: ada@example.com/ }),
    ).toHaveTextContent('A');
    unmount();
    h.auth = signedIn({
      user: { ...ada, photoURL: 'https://example.com/a.jpg' },
    });
    render(<AccountButton />);
    const img = document.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'https://example.com/a.jpg');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('signed in: the menu shows who you are, and closes on Escape and on an outside click', () => {
    h.auth = signedIn();
    render(<AccountButton />);
    const avatar = screen.getByRole('button', { name: /Account:/ });
    expect(avatar).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(avatar);
    const menu = screen.getByRole('menu');
    expect(menu).toHaveTextContent('Ada Lovelace');
    expect(menu).toHaveTextContent('ada@example.com');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(avatar);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('signed in: "Sign out…" opens the confirmation, and passes the upload state on', () => {
    h.auth = signedIn();
    render(<AccountButton uploading />);
    fireEvent.click(screen.getByRole('button', { name: /Account:/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }));
    const dialog = screen.getByRole('dialog', { name: 'Sign out?' });
    expect(
      within(dialog).getByRole('button', { name: 'Sign out' }),
    ).toBeDisabled();
  });
});

describe('SignOutDialog', () => {
  const seed = () => {
    localStorage.setItem('clip-to-track:clips:v1', '[1]');
    localStorage.setItem('clip-to-track:settings:v1', '{}');
    localStorage.setItem('clip-to-track:sheet-snap', 'half');
    localStorage.setItem('clip-to-track:example', '{}');
  };

  it('before sync exists: just signs out and leaves this device untouched', async () => {
    seed();
    const onClose = vi.fn();
    const reload = vi.fn();
    render(<SignOutDialog onClose={onClose} reload={reload} />);
    expect(
      screen.getByText('Your clips and settings stay on this device.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.signOut).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem('clip-to-track:clips:v1')).toBe('[1]');
  });

  // P2-T5
  it('with sync: removes the synced data from this device by default, keeps layout + example, then reloads', async () => {
    seed();
    const reload = vi.fn();
    render(<SignOutDialog wipeAvailable onClose={vi.fn()} reload={reload} />);
    expect(
      screen.getByRole('radio', { name: /Remove my clips/ }),
    ).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('clip-to-track:clips:v1')).toBeNull();
    expect(localStorage.getItem('clip-to-track:settings:v1')).toBeNull();
    expect(localStorage.getItem('clip-to-track:sheet-snap')).toBe('half');
    expect(localStorage.getItem('clip-to-track:example')).toBe('{}');
  });

  // P2-T6
  it('with sync: "Keep a copy on this device" removes nothing and does not reload', async () => {
    seed();
    const onClose = vi.fn();
    const reload = vi.fn();
    render(<SignOutDialog wipeAvailable onClose={onClose} reload={reload} />);
    fireEvent.click(screen.getByRole('radio', { name: /Keep a copy/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem('clip-to-track:clips:v1')).toBe('[1]');
  });

  it('blocks signing out while a video is being added', () => {
    render(<SignOutDialog wipeAvailable uploading onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent(/still being added/);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it('if signing out fails: says so, stays open, and removes nothing', async () => {
    seed();
    h.signOut.mockResolvedValue(false);
    const reload = vi.fn();
    const onClose = vi.fn();
    render(<SignOutDialog wipeAvailable onClose={onClose} reload={reload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Couldn.t sign out/,
    );
    expect(reload).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(localStorage.getItem('clip-to-track:clips:v1')).toBe('[1]');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled(); // can try again
  });

  it('Cancel and Escape close it without signing out; Escape does not reach the dialog underneath', () => {
    const onClose = vi.fn();
    const under = vi.fn();
    document.addEventListener('keydown', under);
    render(<SignOutDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(under).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
    document.removeEventListener('keydown', under);
  });
});

describe('Settings → Account', () => {
  const settings = () =>
    render(
      <Settings
        onClose={vi.fn()}
        clipCount={0}
        layoutIsDefault
        onResetLayout={vi.fn()}
        onClearClips={vi.fn()}
        exampleOn
        exampleBusy={false}
        onExampleChange={vi.fn()}
      />,
    );
  const projectsSection = () =>
    screen.getByRole('heading', { name: 'Projects' }).closest('section')!;

  it('accounts not configured: no Account block, and Projects stays first without a divider', () => {
    h.auth = state({ available: false });
    settings();
    expect(screen.queryByRole('heading', { name: 'Account' })).toBeNull();
    expect(projectsSection()).not.toHaveClass('has-divider');
  });

  it('guest: a Sign in action, honest that nothing syncs yet; Projects gets its divider', () => {
    settings();
    const section = screen
      .getByRole('heading', { name: 'Account' })
      .closest('section')!;
    expect(
      within(section).getByText(/Everything stays on this device/),
    ).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Sign in' }));
    expect(h.signIn).toHaveBeenCalledTimes(1);
    expect(projectsSection()).toHaveClass('has-divider');
  });

  it('signed in: shows the email and a Sign out… action', () => {
    h.auth = signedIn();
    settings();
    const section = screen
      .getByRole('heading', { name: 'Account' })
      .closest('section')!;
    expect(within(section).getByText('ada@example.com')).toBeInTheDocument();
    expect(
      within(section).getByText(/not switched on yet/),
    ).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: /Sign out/ }));
    expect(
      screen.getByRole('dialog', { name: 'Sign out?' }),
    ).toBeInTheDocument();
  });

  it('shows a sign-in error inside the section', () => {
    h.auth = state({ error: 'Sign-in failed. Please try again.' });
    render(<AccountSection />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in failed');
  });

  it('is hidden while loading', () => {
    h.auth = state({ status: 'loading' });
    const { container } = render(<AccountSection />);
    expect(container).toBeEmptyDOMElement();
  });
});
