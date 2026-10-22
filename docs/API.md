# API contract (initial implementation)

Base URL: `http://localhost:4000`. JSON API responses wrap success data in `{ "data": ... }`; failures use `{ "error": { "code": "...", "message": "...", "details": [] } }`. Operational routes require `Authorization: Bearer <accessToken>`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | Liveness and configured storage mode |
| POST | `/api/auth/login` | Public, rate-limited | Login by email/phone and password; returns access token and sets HTTP-only refresh cookie |
| POST | `/api/auth/refresh` | Refresh cookie | Rotates stored hashed refresh token and returns a new access token |
| POST | `/api/auth/logout` | Refresh cookie optional | Revokes refresh token and clears cookie |
| GET | `/api/auth/me` | `dashboard.view` | Current account |
| GET | `/api/dashboard` | `dashboard.view` | Active-campus counts and recent students |
| GET | `/api/school` | `school.view` | Active-campus profile |
| PUT | `/api/school` | `school.edit` | Update active-campus name, address and phone; audit recorded |
| GET | `/api/academic-year` | `school.view` | Current academic year for the active campus |
| GET | `/api/academic-years` | `school.view` | List active-campus academic years |
| POST | `/api/academic-years` | `school.edit` | Create a planned academic year; campus comes from the token |
| PATCH | `/api/academic-years/:yearId/activate` | `school.edit` | Activate a campus-owned year and close the previously active year |
| GET | `/api/terms` | `school.view` | List terms belonging to active-campus academic years |
| POST | `/api/terms` | `school.edit` | Add a term within the active academic year's date range |
| GET | `/api/grades` | `school.view` | List active-campus grade levels |
| POST | `/api/grades` | `school.edit` | Add a bilingual grade level |
| POST | `/api/sections` | `school.edit` | Add a section for a grade in the active academic year |
| GET | `/api/subjects` | `school.view` | List active-campus subjects |
| POST | `/api/subjects` | `school.edit` | Add a bilingual subject |
| GET | `/api/students` | `students.view` | Active-campus student list |
| POST | `/api/students` | `students.edit` | Validate/create an active-campus student |
| GET | `/api/sections` | `attendance.view` | Active-campus sections in the current academic year |
| GET | `/api/attendance` | `attendance.view` | Active-campus attendance sessions |
| POST | `/api/attendance` | `attendance.take` | Create attendance for currently enrolled students in an active-campus section; client UUID makes retries idempotent |
| GET | `/api/marks` | `marks.view` | Active-campus marks |
| POST | `/api/marks` | `marks.enter` | Create a bounded draft mark; client UUID makes retries idempotent |

Academic-year creation produces a `planned` year. Activating a planned year closes the prior active year; this is audited. Terms can currently be added only to the active year and must fall within its Gregorian date boundaries. Organization and campus IDs are read from signed token claims; request-body campus IDs are not used. Routes, permissions and schemas remain incomplete for the full Release 1 inventory. This document is not a statement that all planned endpoints exist.
