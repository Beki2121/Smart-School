import { createLibraryController } from '../controllers/library.controller.js';

const routes = {
  categories(app, c, x) { app.get('/api/library/categories', c.requirePermission('library.catalog.view'), x.categories); },
  createCategory(app, c, x) { app.post('/api/library/categories', c.requirePermission('library.catalog.manage'), x.createCategory); },
  updateCategory(app, c, x) { app.patch('/api/library/categories/:categoryId', c.requirePermission('library.catalog.manage'), x.updateCategory); },
  books(app, c, x) { app.get('/api/library/books', c.requirePermission('library.catalog.view'), x.books); },
  createBook(app, c, x) { app.post('/api/library/books', c.requirePermission('library.catalog.manage'), x.createBook); },
  updateBook(app, c, x) { app.patch('/api/library/books/:bookId', c.requirePermission('library.catalog.manage'), x.updateBook); },
  archiveBook(app, c, x) { app.post('/api/library/books/:bookId/archive', c.requirePermission('library.catalog.manage'), x.archiveBook); },
  copies(app, c, x) { app.get('/api/library/copies', c.requirePermission('library.catalog.view'), x.copies); },
  copyByBarcode(app, c, x) { app.get('/api/library/barcodes/:barcode', c.requirePermission('library.catalog.view'), x.copyByBarcode); },
  createCopy(app, c, x) { app.post('/api/library/copies', c.requirePermission('library.catalog.manage'), x.createCopy); },
  updateCopy(app, c, x) { app.patch('/api/library/copies/:copyId', c.requirePermission('library.catalog.manage'), x.updateCopy); },
  archiveCopy(app, c, x) { app.post('/api/library/copies/:copyId/archive', c.requirePermission('library.catalog.manage'), x.archiveCopy); },
  members(app, c, x) { app.get('/api/library/members', c.requirePermission('library.members.manage'), x.members); },
  addMember(app, c, x) { app.post('/api/library/members', c.requirePermission('library.members.manage'), x.addMember); },
  settings(app, c, x) { app.get('/api/library/settings', c.requirePermission('library.catalog.view'), x.settings); },
  updateSettings(app, c, x) { app.put('/api/library/settings', c.requirePermission('library.catalog.manage'), x.updateSettings); },
  dashboard(app, c, x) { app.get('/api/library/dashboard', c.requirePermission('library.catalog.view'), x.dashboard); },
  loans(app, c, x) { app.get('/api/library/loans', c.requirePermission('library.circulation.manage'), x.loans); },
  issue(app, c, x) { app.post('/api/library/loans', c.requirePermission('library.circulation.manage'), x.issue); },
  returnLoan(app, c, x) { app.post('/api/library/loans/:loanId/return', c.requirePermission('library.circulation.manage'), x.returnLoan); },
  renewLoan(app, c, x) { app.post('/api/library/loans/:loanId/renew', c.requirePermission('library.circulation.manage'), x.renewLoan); },
  reservations(app, c, x) { app.get('/api/library/reservations', c.requirePermission('library.circulation.manage'), x.reservations); },
  reserve(app, c, x) { app.post('/api/library/reservations', c.requirePermission('library.circulation.manage'), x.reserve); },
  cancelReservation(app, c, x) { app.post('/api/library/reservations/:reservationId/cancel', c.requirePermission('library.circulation.manage'), x.cancelReservation); },
  fines(app, c, x) { app.get('/api/library/fines', c.requirePermission('library.fines.view'), x.fines); },
  payFine(app, c, x) { app.post('/api/library/fines/:fineId/pay', c.requirePermission('library.fines.manage'), x.payFine); },
  waiveFine(app, c, x) { app.post('/api/library/fines/:fineId/waive', c.requirePermission('library.fines.waive'), x.waiveFine); },
  portal(app, c, x) { app.get('/api/portal/library', c.requirePermission('library.portal.view'), x.portal); }
};

export function registerLibraryRoutes(app, context, routeIds) {
  const controller = createLibraryController(context);
  for (const routeId of routeIds) routes[routeId](app, context, controller);
}
