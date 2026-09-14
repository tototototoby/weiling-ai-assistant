import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServerSessionMock, isAdminEmailMock, redirectMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  isAdminEmailMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('@/lib/admin', () => ({
  isAdminEmail: isAdminEmailMock,
}));

vi.mock('@/lib/session', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/locale', () => ({
  getMessages: vi.fn(),
  getRequestLocale: vi.fn().mockResolvedValue('en'),
}));

beforeEach(() => {
  vi.clearAllMocks();
  redirectMock.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  });
});

describe('authenticated route redirects', () => {
  it('sends signed-out home visitors to login', async () => {
    getServerSessionMock.mockResolvedValue(null);
    const { default: HomePage } = await import('../page');

    await expect(HomePage()).rejects.toThrow('NEXT_REDIRECT');

    expect(redirectMock).toHaveBeenCalledWith('/login');
    expect(isAdminEmailMock).not.toHaveBeenCalled();
  });

  it.each([
    { admin: true, destination: '/admin/bots' },
    { admin: false, destination: '/chat' },
  ])('sends signed-in home visitors to $destination', async ({ admin, destination }) => {
    getServerSessionMock.mockResolvedValue({ user: { email: 'user@example.com' } });
    isAdminEmailMock.mockReturnValue(admin);
    const { default: HomePage } = await import('../page');

    await expect(HomePage()).rejects.toThrow('NEXT_REDIRECT');

    expect(isAdminEmailMock).toHaveBeenCalledWith('user@example.com');
    expect(redirectMock).toHaveBeenCalledWith(destination);
  });

  it.each([
    { admin: true, destination: '/admin/bots', route: 'login' },
    { admin: false, destination: '/chat', route: 'login' },
    { admin: true, destination: '/admin/bots', route: 'register' },
    { admin: false, destination: '/chat', route: 'register' },
  ])('sends a signed-in $route visitor to $destination', async ({ admin, destination, route }) => {
    getServerSessionMock.mockResolvedValue({ user: { email: 'user@example.com' } });
    isAdminEmailMock.mockReturnValue(admin);
    const page = route === 'login'
      ? (await import('../login/page')).default
      : (await import('../register/page')).default;

    await expect(page()).rejects.toThrow('NEXT_REDIRECT');

    expect(isAdminEmailMock).toHaveBeenCalledWith('user@example.com');
    expect(redirectMock).toHaveBeenCalledWith(destination);
  });
});
