export function createLibraryController(context) {
  const { parse, repo, libraryBookSchema, libraryCategorySchema, libraryCopySchema,
    libraryMemberSchema, librarySettingsSchema, libraryIssueSchema, libraryReturnSchema,
    libraryRenewSchema, libraryReservationSchema, libraryFineStatusSchema,
    libraryFineWaiverSchema, libraryIdSchema, libraryListQuerySchema, libraryBarcodeSchema } = context;
  const missing = (response, code, message) => response.status(404).json({ error: { code, message } });
  return {
    categories: async (req, res, next) => {
      try { res.json({ data: await repo.listLibraryCategories(req.user) }); } catch (error) { next(error); }
    },
    createCategory: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createLibraryCategory(parse(libraryCategorySchema, req.body), req.user) }); }
      catch (error) { next(error); }
    },
    updateCategory: async (req, res, next) => {
      try {
        const row = await repo.updateLibraryCategory(parse(libraryIdSchema, req.params.categoryId),
          parse(libraryCategorySchema.partial(), req.body), req.user);
        if (!row) return missing(res, 'LIBRARY_CATEGORY_NOT_FOUND', 'Category not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    books: async (req, res, next) => {
      try { res.json({ data: await repo.listLibraryBooks(parse(libraryListQuerySchema, req.query), req.user) }); }
      catch (error) { next(error); }
    },
    createBook: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createLibraryBook(parse(libraryBookSchema, req.body), req.user) }); }
      catch (error) { next(error); }
    },
    updateBook: async (req, res, next) => {
      try {
        const row = await repo.updateLibraryBook(parse(libraryIdSchema, req.params.bookId),
          parse(libraryBookSchema.partial(), req.body), req.user);
        if (!row) return missing(res, 'LIBRARY_BOOK_NOT_FOUND', 'Book not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    archiveBook: async (req, res, next) => {
      try {
        const row = await repo.archiveLibraryBook(parse(libraryIdSchema, req.params.bookId), req.user);
        if (!row) return missing(res, 'LIBRARY_BOOK_NOT_FOUND', 'Book not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    copies: async (req, res, next) => {
      try { res.json({ data: await repo.listLibraryCopies(parse(libraryListQuerySchema, req.query), req.user) }); }
      catch (error) { next(error); }
    },
    copyByBarcode: async (req, res, next) => {
      try {
        const row = await repo.findLibraryCopyByBarcode(parse(libraryBarcodeSchema, req.params.barcode), req.user);
        if (!row) return missing(res, 'LIBRARY_COPY_NOT_FOUND', 'Barcode was not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    createCopy: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createLibraryCopy(parse(libraryCopySchema, req.body), req.user) }); }
      catch (error) { next(error); }
    },
    updateCopy: async (req, res, next) => {
      try {
        const row = await repo.updateLibraryCopy(parse(libraryIdSchema, req.params.copyId),
          parse(libraryCopySchema.partial().omit({ bookId: true }), req.body), req.user);
        if (!row) return missing(res, 'LIBRARY_COPY_NOT_FOUND', 'Copy not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    archiveCopy: async (req, res, next) => {
      try {
        const row = await repo.archiveLibraryCopy(parse(libraryIdSchema, req.params.copyId), req.user);
        if (!row) return missing(res, 'LIBRARY_COPY_NOT_FOUND', 'Copy not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    members: async (req, res, next) => {
      try { res.json({ data: await repo.listLibraryMembers(req.user) }); } catch (error) { next(error); }
    },
    addMember: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.addLibraryMember(parse(libraryMemberSchema, req.body), req.user) }); }
      catch (error) { next(error); }
    },
    settings: async (req, res, next) => {
      try { res.json({ data: await repo.getLibrarySettings(req.user) }); } catch (error) { next(error); }
    },
    updateSettings: async (req, res, next) => {
      try { res.json({ data: await repo.updateLibrarySettings(parse(librarySettingsSchema, req.body), req.user) }); }
      catch (error) { next(error); }
    },
    dashboard: async (req, res, next) => {
      try { res.json({ data: await repo.getLibraryDashboard(req.user) }); } catch (error) { next(error); }
    },
    loans: async (req, res, next) => {
      try { res.json({ data: await repo.listLibraryLoans(req.query.status, req.user) }); } catch (error) { next(error); }
    },
    issue: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.issueLibraryCopy(parse(libraryIssueSchema, req.body), req.user) }); }
      catch (error) { next(error); }
    },
    returnLoan: async (req, res, next) => {
      try {
        const row = await repo.returnLibraryLoan(parse(libraryIdSchema, req.params.loanId),
          parse(libraryReturnSchema, req.body), req.user);
        if (!row) return missing(res, 'LIBRARY_LOAN_NOT_FOUND', 'Loan not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    renewLoan: async (req, res, next) => {
      try {
        const row = await repo.renewLibraryLoan(parse(libraryIdSchema, req.params.loanId),
          parse(libraryRenewSchema, req.body), req.user);
        if (!row) return missing(res, 'LIBRARY_LOAN_NOT_FOUND', 'Loan not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    reservations: async (req, res, next) => {
      try { res.json({ data: await repo.listLibraryReservations(req.user) }); } catch (error) { next(error); }
    },
    reserve: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.reserveLibraryBook(parse(libraryReservationSchema, req.body), req.user) }); }
      catch (error) { next(error); }
    },
    cancelReservation: async (req, res, next) => {
      try {
        const row = await repo.cancelLibraryReservation(parse(libraryIdSchema, req.params.reservationId), req.user);
        if (!row) return missing(res, 'LIBRARY_RESERVATION_NOT_FOUND', 'Reservation not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    fines: async (req, res, next) => {
      try { res.json({ data: await repo.listLibraryFines(req.user) }); } catch (error) { next(error); }
    },
    payFine: async (req, res, next) => {
      try {
        const row = await repo.updateLibraryFine(parse(libraryIdSchema, req.params.fineId),
          parse(libraryFineStatusSchema, req.body), req.user);
        if (!row) return missing(res, 'LIBRARY_FINE_NOT_FOUND', 'Fine not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    waiveFine: async (req, res, next) => {
      try {
        const row = await repo.waiveLibraryFine(parse(libraryIdSchema, req.params.fineId),
          parse(libraryFineWaiverSchema, req.body), req.user);
        if (!row) return missing(res, 'LIBRARY_FINE_NOT_FOUND', 'Fine not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    portal: async (req, res, next) => {
      try { res.set('Cache-Control', 'no-store').json({ data: await repo.getPortalLibrary(req.user) }); }
      catch (error) { next(error); }
    }
  };
}
