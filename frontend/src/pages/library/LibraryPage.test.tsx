import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import LibraryPage from './LibraryPage';

vi.mock('../../api', () => ({
  api: {
    libraryDashboard: vi.fn(),
    libraryCategories: vi.fn(),
    libraryBooks: vi.fn(),
    librarySettings: vi.fn(),
    libraryCopies: vi.fn(),
    libraryMembers: vi.fn(),
    libraryLoans: vi.fn(),
    libraryReservations: vi.fn(),
    libraryFines: vi.fn(),
    portalLibrary: vi.fn()
  }
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LibraryPage', () => {
  it('loads the catalogue and management actions for a librarian', async () => {
    vi.mocked(api.libraryDashboard).mockResolvedValue({
      total: 1, available: 1, borrowed: 0, overdue: 0
    });
    vi.mocked(api.libraryCategories).mockResolvedValue([{
      id: 'category-id', name: 'Fiction', status: 'active'
    }]);
    vi.mocked(api.libraryBooks).mockResolvedValue([{
      id: 'book-id', categoryId: 'category-id', title: 'The Contract Book',
      author: 'A. Writer', isbn: '123', publisher: '', description: 'A brief synopsis.',
      status: 'active', copies: []
    }]);
    vi.mocked(api.librarySettings).mockResolvedValue({
      loanPeriodDays: 14, maxActiveLoans: 5, maxRenewals: 2,
      fineMinorPerDay: 100, currencyCode: 'ETB'
    });
    vi.mocked(api.libraryCopies).mockResolvedValue([]);
    vi.mocked(api.libraryMembers).mockResolvedValue([]);
    vi.mocked(api.libraryLoans).mockResolvedValue([]);
    vi.mocked(api.libraryReservations).mockResolvedValue([]);
    vi.mocked(api.libraryFines).mockResolvedValue([]);

    render(<LibraryPage t={(key) => key} permissions={[
      'library.catalog.view', 'library.catalog.manage', 'library.circulation.manage',
      'library.members.manage', 'library.fines.view', 'library.reports.view'
    ]} />);

    expect(await screen.findByRole('heading', { name: 'The Contract Book' })).toBeTruthy();
    expect(screen.getByText('libraryCatalogue')).toBeTruthy();
    expect(screen.getByText('libraryAddBook')).toBeTruthy();
    expect(screen.getByText('libraryCategories')).toBeTruthy();
    expect(screen.getByText('libraryAddCopy')).toBeTruthy();
    expect(screen.getByText('libraryMembers')).toBeTruthy();
    expect(screen.getByText('libraryFines')).toBeTruthy();
    expect(screen.getByText('A brief synopsis.')).toBeTruthy();
    expect(screen.getByText('libraryCopiesCsv')).toBeTruthy();
    await waitFor(() => expect(api.libraryBooks).toHaveBeenCalledOnce());
    expect(api.portalLibrary).not.toHaveBeenCalled();
  });

  it('shows only portal data without catalogue management for a student', async () => {
    vi.mocked(api.portalLibrary).mockResolvedValue({
      loans: [{
        id: 'loan-id', bookId: 'book-id', copyId: 'copy-id', memberId: 'member-id',
        issuedOn: '2026-11-01', returnedOn: null, renewalCount: 0,
        book: {
          id: 'book-id', categoryId: null, title: 'My Book', author: 'A. Writer',
          isbn: null, publisher: '', description: '', status: 'active'
        },
        status: 'active', dueOn: '2026-12-01'
      }],
      reservations: [], fines: []
    });

    render(<LibraryPage t={(key) => key} permissions={['library.portal.view']} />);

    expect(await screen.findByText('My Book · active · libraryDue: 2026-12-01')).toBeTruthy();
    expect(screen.queryByText('libraryCatalogue')).toBeNull();
    expect(screen.queryByText('libraryAddBook')).toBeNull();
    expect(api.libraryBooks).not.toHaveBeenCalled();
  });
});
