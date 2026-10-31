**SMART SCHOOL  
MANAGEMENT SYSTEM**

Role-Based Sidebar Menus & Implementation Recommendations

**Prepared for iLink Technologies PLC**

*Product planning document \| 31 October 2026*

# 1. Purpose and Navigation Principles

This document defines a proposed role-based sidebar structure for the Smart School Management System. It starts with the SaaS Platform Admin and continues through school-level operational roles, parents, and students. The menus are a navigation blueprint; they do not claim that every feature is already implemented.

- Show each user only the navigation items permitted by assigned roles and permissions.

- Keep platform-level administration separate from each school's operational dashboard.

- Use expandable sidebar groups, active-page highlighting, and responsive navigation.

- Support users who hold more than one role without duplicate or conflicting navigation.

- Enforce authorization on the server/API as well as hiding unauthorized menu items in the frontend.

# 2. Platform Admin (iLink Super Admin)

*Platform-level access*

- Platform Dashboard

- **Schools Management:** All Schools; Register New School; School Applications; School Details; Activate / Suspend Schools; School Academic Information; School Usage Statistics

- **Subscription Management:** Subscription Plans; Create / Edit Plans; School Subscriptions; Subscription Renewals; Trial Management; Expired Subscriptions; Payment History

- **Platform Finance:** Platform Invoices; Subscription Payments; Payment Transactions; Revenue Reports; Payment Reconciliation

- **Platform Users:** Platform Administrators; Support Staff; User Accounts; Roles & Permissions

- **Global Configuration:** Platform Settings; Language Settings; Currency Settings; Notification Configuration; Email / SMS Configuration; Integration Settings

- **Security & Audit:** Platform Audit Logs; Login History; Access Logs; Security Events; Backup & Recovery

- **Support Management:** Support Tickets; School Support Requests; Issue Tracking; Help Center; System Announcements

- **System Monitoring:** System Health; API Monitoring; Database Monitoring; Storage Usage; Error Logs

# 3. School Administrator

*School-level full access*

- **Dashboard:** Student Statistics; Staff Statistics; Attendance Overview; Financial Overview; Academic Performance; Pending Tasks

- **School Management:** School Profile; School Branches (if applicable); Academic Years; Terms / Semesters; School Calendar; School Configuration

- **Student Management:** Student List; Student Admissions; Student Registration; Student Profiles; Parents / Guardians; Student Documents; Class Assignment; Student Transfers; Student Promotion; Repeated Students; Withdrawn Students; Graduated Students; Alumni Management; Student ID Cards

- **Academic Management:** Grades; Sections / Classes; Subjects; Subject Assignments; Curriculum; Syllabus; Teacher Assignments; Academic Calendar

- **Attendance Management:** Student Attendance; Daily Attendance; Period Attendance; Late Arrivals; Early Departures; Attendance Corrections; Attendance Reports

- **Examinations & Results:** Exam Categories; Exam Schedules; Marks Entry; Grading System; Grade Configuration; Result Approval; Result Publication; Report Cards; Academic Performance Reports

- **Timetable Management:** Class Timetables; Teacher Timetables; Period Management; Classroom Scheduling; Teacher Substitutions

- **Finance & Fees:** Fee Categories; Fee Structures; Student Invoices; Payment Collection; Partial Payments; Payment History; Student Balances; Discounts & Scholarships; Receipts; Financial Statements; Financial Reports

- **Staff & HR Management:** Staff Directory; Teacher Management; Departments; Staff Contracts; Staff Attendance; Leave Management; Staff Assignments

- **Payroll Management:** Salary Structures; Allowances & Deductions; Payroll Processing; Payslips; Payroll History

- **Library Management:** Book Catalog; Book Categories; Issue Books; Return Books; Overdue Books; Library Reports

- **Transport Management:** Vehicles; Drivers; Routes & Stops; Student Transport Assignments; Transport Fees

- **Communication:** Announcements; Messages; Notifications; SMS; Email; Parent Communication

- **Events & Calendar:** School Events; Parent Meetings; Holidays; Examination Calendar; Event Notifications

- **Inventory & Assets:** Asset Register; Stock Management; Asset Assignments; Maintenance Records

- **Reports & Analytics:** Student Reports; Admission Reports; Attendance Reports; Academic Reports; Financial Reports; Staff Reports; Library Reports; Transport Reports

- **Users & Permissions:** User Accounts; Role Management; Permission Management; Parent Accounts; Teacher Accounts; Account Activation / Deactivation

- **Security & Audit:** Activity Logs; User Login History; Financial Audit Logs; Grade Change History; Data Access History

- **Settings:** School Settings; Academic Settings; Grading Settings; Fee Settings; Localization; Notification Settings; Document Templates

- **Support & Help:** Support Tickets; Help Center; Training Materials

# 4. Principal / School Director

*Academic oversight and approval*

- **Dashboard:** School Overview; Student Statistics; Staff Statistics; Attendance Overview; Academic Performance

- **Student Management:** Student List; Student Profiles; Admissions Overview; Student Transfers; Promotion Overview; Discipline Records (if enabled)

- **Academic Management:** Grades & Sections; Subjects; Curriculum; Teacher Assignments; Academic Calendar

- **Attendance:** Student Attendance Overview; Staff Attendance Overview; Absence Reports; Attendance Approval / Corrections

- **Examinations & Results:** Exam Schedules; Marks Overview; Result Review; Result Approval; Result Publication; Report Cards

- **Timetable:** Class Timetables; Teacher Timetables; Substitutions

- **Staff Management:** Staff Directory; Teacher Performance; Staff Assignments; Leave Approvals

- **Finance Overview:** Fee Collection Summary; Outstanding Balances; Financial Reports (read-only, unless authorized)

- **Communication:** School Announcements; Parent Communication; Staff Communication

- **Reports & Analytics:** Academic Reports; Attendance Reports; Student Reports; Staff Reports; Performance Analytics

# 5. Academic Director / Academic Coordinator

*Academic operations*

- Dashboard

- **Academic Structure:** Academic Years; Terms; Grades; Sections; Subjects; Curriculum

- Teacher Assignments

- Timetable Management

- **Examination Management:** Exam Categories; Exam Schedules; Marks Entry Monitoring; Result Review; Result Approval (if authorized)

- Grading Configuration

- Student Promotion

- Academic Reports

- Teacher Performance

- Academic Announcements

# 6. Registrar / Admission Officer

*Admissions and student records*

- Dashboard

- **Student Admissions:** New Applications; Application Review; Admission Approval (if authorized); Rejected Applications; Waiting List

- Student Registration

- **Student Management:** Student List; Student Profiles; Guardian Information; Student Documents; Student ID Cards

- **Enrollment:** Academic-Year Enrollment; Class Assignment; Student Transfers; Student Withdrawals; Student Promotion

- Alumni Management

- Student Records & History

- Admission Reports

# 7. Teacher

*Teaching and classroom operations*

- **Dashboard:** My Classes; My Students; Today's Timetable; Attendance Summary; Pending Marks

- **My Classes:** Assigned Classes; Class Student Lists; Subject Assignments

- **My Students:** Student Profiles (authorized information); Guardian Contacts (authorized information); Academic History

- **Attendance:** Take Attendance; Daily Attendance; Period Attendance; Attendance History; Submit Attendance

- **Examinations & Marks:** Exam Schedules; Marks Entry; Edit Draft Marks; Submit Marks; Student Performance

- **Timetable:** My Timetable; Class Timetable; Substitution Schedule

- **Academic Resources:** Subjects; Curriculum; Syllabus; Lesson Plans; Learning Materials

- **Communication:** Class Announcements; Parent Communication; Messages; Notifications

- **Reports:** Class Attendance; Subject Performance; Student Performance

- **My Profile:** Personal Information; Change Password; Account Settings

# 8. Accountant / Finance Officer

*School finance*

- **Dashboard:** Daily Collections; Total Revenue; Outstanding Fees; Overdue Payments

- **Fee Management:** Fee Categories; Fee Structures; Student Fee Assignments

- **Invoices:** Create Invoice; Student Invoices; Pending Invoices; Overdue Invoices

- **Payments:** Record Payment; Partial Payments; Payment History; CBE Payments; Telebirr Payments; Other Payment Methods

- **Receipts:** Generate Receipts; Print Receipts; Receipt History

- **Student Accounts:** Student Ledger; Student Balances; Outstanding Fees; Payment Statements

- **Discounts & Scholarships:** Discounts; Scholarships; Fee Waivers

- Refunds & Adjustments

- **Financial Reports:** Daily Collection; Monthly Collection; Outstanding Balances; Payment Method Reports; Revenue Reports

- Reconciliation

- My Profile

# 9. HR Manager

*Staff and human resources*

- Dashboard

- **Staff Management:** Staff Directory; Register Staff; Staff Profiles; Employment Contracts; Qualifications; Departments; Staff Documents

- **Teacher Management:** Teacher Assignments; Subject Assignments

- **Staff Attendance:** Daily Attendance; Attendance History; Late Arrivals

- **Leave Management:** Leave Requests; Leave Approvals; Leave Balances; Leave History

- Payroll Overview

- Staff Performance

- HR Reports

- Staff Announcements

- My Profile

# 10. Payroll Officer

*Salary processing*

- Dashboard

- Employee Salary Structures

- Allowances & Benefits

- Deductions

- Payroll Processing

- Payroll Review & Approval

- Payslip Generation

- Salary Payment Records

- Payroll History

- Payroll Reports

- My Profile

# 11. Librarian

*Library operations*

- **Dashboard:** Total Books; Available Books; Issued Books; Overdue Books

- **Book Management:** Book Catalog; Add New Book; Book Categories; Authors & Publishers; Book Copies

- **Book Transactions:** Issue Books; Return Books; Renew Books; Issued Book History

- **Overdue Management:** Overdue Books; Fine Management; Fine Payments (if enabled)

- **Library Members:** Students; Teachers; Staff

- Library Reports

- My Profile

# 12. Transport Manager

*School transport*

- Dashboard

- **Vehicle Management:** Vehicle List; Register Vehicle; Vehicle Documents; Vehicle Maintenance

- **Driver Management:** Driver List; Driver Profiles; Driver Licenses

- **Route Management:** Routes; Stops; Route Schedules

- **Student Transport:** Student Assignments; Pickup / Drop-off Information; Transport Fees

- Transport Attendance

- Transport Reports

- My Profile

# 13. Receptionist / Front Desk Officer

*Front desk operations*

- Dashboard

- Student Directory

- Parent / Guardian Directory

- Visitor Management

- Student Admissions (view or initiate, depending on permission)

- Student Check-in / Check-out

- Parent Inquiries

- Communication

- School Events

- My Profile

# 14. Parent / Guardian

*Restricted to linked children*

- **Dashboard:** My Children; Attendance Summary; Academic Performance; Fee Balance; Recent Announcements

- **My Children:** Child Profiles; Class & Section; Teacher Information

- **Attendance:** Attendance History; Absence Records; Late Arrivals

- **Academic Results:** Exam Results; Term Results; Report Cards; Academic History

- **Fees & Payments:** Fee Invoices; Outstanding Balances; Payment History; Online Payment (when integrated); Receipts; Student Statements

- **Communication:** School Announcements; Teacher Messages; School Notifications

- **Events & Calendar:** School Calendar; Parent Meetings; Upcoming Events

- **My Profile:** Guardian Information; Contact Details; Change Password; Notification Preferences

# 15. Student

*Student self-service*

- Dashboard

- My Profile

- My Classes

- My Timetable

- My Attendance

- My Subjects

- My Examinations

- My Results

- My Report Cards

- My Fee Information (if enabled)

- Learning Materials

- School Announcements

- School Calendar

- My Library

- My Profile Settings

# 16. School IT Administrator

*Technical administration within one school*

- Dashboard

- User Accounts

- Roles & Permissions

- Account Activation / Deactivation

- School Configuration

- Email & SMS Configuration

- Integration Settings

- Document Storage

- Backup & Recovery

- System Logs

- Security & Audit

- Support & Help

# 17. Recommended Role Hierarchy

| **Level** | **Role**             | **Main responsibility**             |
|-----------|----------------------|-------------------------------------|
| 1         | Platform Admin       | Entire SaaS platform                |
| 2         | School Admin         | Entire individual school            |
| 3         | Principal / Director | School leadership and approvals     |
| 4         | Academic Director    | Academic operations                 |
| 5         | Registrar            | Student admissions and records      |
| 6         | Teacher              | Teaching and classroom activities   |
| 7         | Accountant           | School finance                      |
| 8         | HR Manager           | Staff and HR                        |
| 9         | Payroll Officer      | Salary processing                   |
| 10        | Librarian            | Library operations                  |
| 11        | Transport Manager    | School transport                    |
| 12        | Receptionist         | Front desk operations               |
| 13        | Parent / Guardian    | Child information and communication |
| 14        | Student              | Personal academic information       |
| 15        | School IT Admin      | Technical administration            |

# 18. Implementation Recommendations

1.  **Flexible roles and permissions.** Treat the listed roles as suggested starting roles, not 15 hard-coded user types. Build configurable roles and permissions so each school can adapt access to its organization.

2.  **Multiple roles per user.** Allow one account to hold more than one role where appropriate. For example, a Principal may also receive Academic Director permissions. Define how permissions combine and avoid accidental privilege escalation.

3.  **Enforce tenant isolation.** Each school must only access its own records. Enforce school/tenant scope in backend authorization, database queries, and file access. Platform Admin has platform-level access; school users must remain within their authorized school.

4.  **Enforce permissions on the server.** Hiding a menu item in the frontend is not security. Every API endpoint and server-side operation must independently check the authenticated user, tenant membership, role, and permission.

5.  **Use granular permissions.** Separate view, create, edit, delete, approve, publish, export, and manage permissions. For example, a teacher may enter and submit marks but may not publish final results unless explicitly authorized.

6.  **Apply approval workflows.** Use explicit states and approval transitions for sensitive processes such as admissions, attendance corrections, marks, result publication, fee adjustments, refunds, and payroll.

7.  **Audit sensitive actions.** Record who performed important actions, what changed, when it happened, and the relevant school and record. Prioritize financial transactions, student record changes, grade changes, permission changes, and data exports.

8.  **Protect parent and student access.** Parents should only see children linked and verified against their account. Students should only see their own permitted records. Do not rely on a submitted student ID or URL parameter as proof of access.

9.  **Keep platform and school navigation separate.** Build a distinct Platform Admin dashboard and navigation shell. School users should enter the school workspace and see only school-level modules.

10. **Make navigation responsive and usable.** Use collapsible menu groups, active-route highlighting, mobile drawer navigation, clear labels, and sensible grouping. On desktop, optionally support a compact icon-only sidebar.

11. **Show useful status indicators.** Use badges for meaningful counts such as pending approvals, unread messages, overdue invoices, and tasks awaiting action. Avoid noisy or unfiltered counts.

12. **Configure optional modules.** Allow schools to enable or hide modules such as transport, library, payroll, inventory, and student self-service according to subscription and operational needs.

13. **Support localization.** Plan for configurable language, date, time, and currency presentation. Validate Ethiopian calendar and ETB handling with pilot schools; support English and Amharic where required.

14. **Protect financial workflows.** Use unique transaction references, duplicate-payment protection, controlled reversals rather than silent deletion, receipt history, and reconciliation. Add payment gateway integrations only after provider requirements are verified.

15. **Test role and tenant boundaries.** Create automated tests for allowed and denied actions across roles and across at least two schools. Test attempts to access another school's student, invoice, document, result, or report by changing an ID.

16. **Document and review permissions.** Maintain a permission matrix showing which roles can view, create, edit, delete, approve, publish, and export each resource. Review access periodically and revoke it promptly when staff leave or change duties.

# 19. Practical Permission Examples

| **Function**               | **Teacher**          | **Principal**                   | **School Admin**   |
|----------------------------|----------------------|---------------------------------|--------------------|
| Take class attendance      | Create / submit      | View / oversee                  | Manage             |
| Enter marks                | Create / edit drafts | Review / approve if authorized  | Manage / authorize |
| Publish final results      | No, by default       | Approve / publish if authorized | Manage / authorize |
| Record student fee payment | No, by default       | View summary                    | Manage / authorize |
| View student profile       | Assigned students    | School-wide if authorized       | Manage             |
| Manage user roles          | No                   | No, unless delegated            | Manage             |

# 20. Final Design Guidance

Use this document as the starting point for navigation and access-control design. Validate role names, responsibilities, approval authority, and optional modules with pilot schools before finalizing development. The sidebar is a presentation of permissions; the backend permission model remains the source of truth.