# Monthly Expense Tracker — Project Specification

## 1. Project Overview

Build a modern, aesthetically pleasant, responsive monthly expense tracking web application.

The application should allow:

1. A user to privately track their own expenses.
2. A user to create a group and invite other users.
3. Group members to collectively record and track expenses.
4. Group administrators to define expense categories and monthly budgets.
5. Users to view monthly spending, budgets, category-wise spending, and historical records.
6. Users to export expense data for a selected month.

The application should feel like a polished production-quality SaaS application rather than a basic CRUD project.

Prioritize:

* Clean UI
* Excellent UX
* Responsive design
* Strong type safety
* Secure database access
* Good component architecture
* Maintainable code
* Proper loading/error/empty states
* Smooth but subtle animations
* Accessibility
* Mobile usability

Do NOT attempt to implement the entire application in one step.

The project must be developed incrementally in clearly defined phases.

---

# 2. Technology Stack

## Frontend + Backend

Use:

* Next.js
* TypeScript
* Server Components where appropriate
* Client Components only where interactivity requires them

## Database / Authentication

Use:

* Supabase
* PostgreSQL
* Supabase Authentication
* Supabase Row Level Security (RLS)

## Styling

Use:

* Tailwind CSS
* A clean component system such as shadcn/ui where appropriate

## Animations

Use:

* Framer Motion / Motion

Animations should be subtle and purposeful.

Do not over-animate the application.

## Notifications

Use toast notifications for:

* Expense created
* Expense updated
* Expense deleted
* Group created
* Invitation sent
* Invitation accepted / declined
* Category created
* Budget updated
* Authentication errors
* Validation errors
* Export completed

### In-app notifications

Some events need to reach a user who is not on the page where they happened.

Provide a lightweight in-app notification surface in the top bar showing a
count of items awaiting the user's attention, linking to where they can act.

For the MVP the only such item is a pending group invitation.

Keep the architecture open to further notification types later, but do not
build a general notification system, a notifications table, or push
notifications for the MVP.

## Email

Use an email provider with a useful free tier.

Evaluate options such as:

* Resend
* Brevo
* Mailjet

Choose the provider that is easiest to integrate securely with Next.js and provides an appropriate free allowance.

Do not hard-code provider credentials.

Store credentials in environment variables.

---

# 3. Development Philosophy

Follow these principles throughout the project.

### Build incrementally

Implement the application in phases.

After completing each phase:

1. Run the application.
2. Run TypeScript checks.
3. Run linting.
4. Run tests where applicable.
5. Fix all errors.
6. Verify that existing functionality still works.
7. Only then move to the next phase.

Do not make large uncontrolled changes across the entire codebase.

### Avoid premature complexity

Do not introduce unnecessary:

* Libraries
* Abstractions
* State-management frameworks
* Design patterns
* Microservices
* Complex caching

Use the simplest architecture that remains scalable and maintainable.

### TypeScript

Use strict TypeScript.

Avoid:

```ts
any
```

unless there is a very strong reason.

Create proper types for:

* User
* Group
* GroupMember
* Expense
* Category
* Budget
* Invitation
* PaymentMode
* Currency
* Dashboard statistics

---

# 4. Authentication

Implement:

* Sign up
* Sign in
* Sign out
* Persisted authentication session

The user should remain signed in when:

* The browser is refreshed
* The user closes and reopens the browser

The session should end when the user explicitly signs out.

Use Supabase Authentication.

Support:

* Email/password authentication

Design the architecture so additional authentication methods can be added later.

### Authentication requirements

Unauthenticated users should not be able to access:

* Dashboard
* Expenses
* Groups
* Budgets
* Profile
* Other private application pages

Redirect unauthenticated users to the sign-in page.

Authenticated users should not see authentication pages unnecessarily.

---

# 5. User Profile

Create a basic user profile system.

A user should have at minimum:

* ID
* Name
* Email
* Created timestamp
* Updated timestamp

The user's name should be used throughout the application.

For example:

```text
Paid by: Omkesh
```

rather than displaying the user's UUID.

Allow the user to update their display name.

Design the database so additional profile information can be added later.

---

# 6. Personal Expenses

Every authenticated user should automatically have a personal expense area.

Personal expenses are private.

Other users must NOT be able to access them.

Each personal expense should contain:

### Required

* Item name
* Amount
* Paid by
* Date

### Optional

* Category
* Payment mode
* Notes

### Automatically generated

* Timestamp
* Expense ID
* User ID
* Created timestamp
* Updated timestamp

---

# 7. Expense Fields

Create an expense form with the following fields.

## Item Name

Mandatory.

Example:

```text
Groceries
Uber
Restaurant
Electricity Bill
```

Validate that it is not empty.

---

## Amount

Mandatory.

Must be a positive number.

Do not allow:

* Negative values
* Zero
* Invalid numeric values

Currency should NOT be manually entered for every expense.

Currency comes from the group configuration for group expenses.

For personal expenses, use a sensible default currency configuration and allow the architecture to support currency customization later.

---

## Paid By

Mandatory.

### Personal expense

Default:

```text
Current user
```

For personal expenses, this should normally remain the current user.

### Group expense

The user should be able to select any member of the group.

Example:

```text
Paid by
[ Omkesh ▼ ]

Omkesh
Rahul
Amit
Sneha
```

The default should be the currently logged-in user.

---

## Date

Mandatory.

Default:

```text
Today
```

The user must be able to select another date.

Display dates in a friendly format such as:

```text
10 Sept 2026
```

Internally, store dates in a proper database-compatible format.

Be careful about timezone handling.

Do not store formatted display strings as the canonical date.

---

## Category

Allow selection of one category.

Categories can come from:

* Default categories
* Group-created custom categories
* Personal categories where applicable

Example default categories:

* Food
* Groceries
* Transportation
* Shopping
* Bills & Utilities
* Entertainment
* Healthcare
* Travel
* Education
* Rent
* Insurance
* Subscriptions
* Personal Care
* Other

Do not force all default categories to be used.

---

## Payment Mode

Provide common options:

* UPI
* Credit Card
* Debit Card
* Cash
* Bank Transfer
* Net Banking
* Wallet
* Other

Design this so additional payment modes can be added later.

---

## Notes

Optional free-text field.

Example:

```text
Dinner with friends
```

---

## Timestamp

Automatically generated by the backend/database.

The user should not manually enter this.

Use timestamps for:

* Created at
* Updated at

The created timestamp should represent when the expense was recorded.

---

# 8. Groups

Users should be able to create groups.

Example:

```text
Goa Trip 2026
Flat Expenses
Family Expenses
Office Team
```

A group should contain at minimum:

* Group ID
* Group name
* Description (optional)
* Currency
* Created by
* Created timestamp
* Updated timestamp

---

# 9. Group Roles

Every group must have roles.

At minimum:

### Admin

The group creator automatically becomes the admin.

Admin can:

* Edit group details
* Select currency
* Manage categories
* Set budgets
* Invite members
* Remove members
* View group dashboard
* View group expenses

### Member

Members can:

* View group dashboard
* View group expenses
* Add expenses
* Select another group member as "Paid by"
* View category budgets
* View spending statistics

Members cannot:

* Change group currency
* Change group budgets
* Manage group categories
* Remove other members
* Change group ownership

Design the permission model so more roles can be introduced later.

---

# 10. Group Currency

When creating a group, the creator MUST select the group's currency.

Example:

```text
Currency

₹ Indian Rupee (INR)
$ US Dollar (USD)
€ Euro (EUR)
£ British Pound (GBP)
```

The selected currency applies to group expenses and budgets.

An expense in a group must use the group's currency.

Do not allow different currencies for individual expenses within the same group in the MVP.

Store the currency as a proper currency code such as:

```text
INR
USD
EUR
GBP
```

Do not store currency symbols as the canonical database value.

---

# 11. Group Invitations

The group admin should be able to invite users by email address.

Invitations are answered **inside the application**. Email is a fallback, not
the mechanism.

Primary flow — the invited person already has an account:

```text
Admin
  ↓
Enter member email
  ↓
Invitation created
  ↓
Appears in that user's in-app invitations
(with a notification count in the top bar)
  ↓
User accepts or declines it in the app
  ↓
On accept: user becomes group member
```

Fallback flow — the invited person has no account yet:

```text
Invitation created
  ↓
Invitation email sent, containing a one-time link
  ↓
User opens the link, signs up or signs in
  ↓
User accepts the invitation
  ↓
User becomes group member
```

The two flows must end in the same place, enforced the same way. Accepting
should not depend on how the invitation was found.

### In-app invitations

Provide a page listing the invitations addressed to the signed-in user.

Each entry should show:

* Group name
* Group currency
* Inviter name
* Role being offered
* Expiration information

Provide both:

```text
[ Accept ]   [ Decline ]
```

Declining must be recorded, not merely hidden — the group's admin should be
able to see that the invitation was declined, and should be able to invite
that person again afterwards.

An accepted or declined invitation must disappear from the user's list, and
the notification count must agree with it.

### Rules

Do NOT expose the group to an invited user before the invitation is accepted.
The invitation may show the group's name, currency and inviter — nothing more.

An invitation email should contain:

* Group name
* Inviter name
* Invitation link
* Expiration information

Prevent:

* Duplicate invitations
* Duplicate memberships
* Invalid/expired invitation acceptance
* Acting on an invitation addressed to somebody else
* An invitee changing what an invitation grants (its role or its expiry)

Design invitations with an expiration mechanism.

An invitation must only ever grant the role it was issued with, and only to the
account holding the address it was sent to. Enforce this in the database, not
only in the application.

---

# 12. Email Service

Integrate a free email service.

Evaluate:

* Resend
* Brevo
* Mailjet

Use environment variables for:

```text
EMAIL_API_KEY
EMAIL_FROM
```

Do not expose API keys to the browser.

Email sending must happen server-side.

Create a clean email service abstraction so the provider can be replaced later.

For example:

```text
lib/email/
```

The initial email should be the group invitation email.

### Email is optional

Because invitations are answered in the application (§11), the email service
must not be a hard dependency.

With no provider configured, or when the provider rejects a message:

* The invitation must still be created.
* It must still appear in the invitee's in-app invitations.
* The application must degrade visibly, not silently — offer the admin the
  one-time link so they can pass it on to someone without an account.

Never let a failed send take down the action that triggered it, and never show
a raw provider error to a user.

---

# 13. Group Categories

While creating a group, the admin should be able to configure categories.

Provide default categories such as:

* Food
* Groceries
* Transportation
* Shopping
* Bills & Utilities
* Entertainment
* Healthcare
* Travel
* Education
* Rent
* Insurance
* Subscriptions
* Personal Care
* Other

Allow the admin to:

* Select default categories
* Add custom categories
* Rename custom categories if appropriate
* Disable/remove categories that are not needed

Categories must be associated with the group.

All group members should see the group's categories while adding expenses.

---

# 14. Creating Categories While Adding Expense

While adding an expense, if the desired category does not exist:

Provide:

```text
+ Create new category
```

However, respect permissions.

If category management is restricted to admins, either:

1. Let members request a category, or
2. Allow members to create categories with appropriate permissions.

Prefer a simple MVP implementation:

* Admin manages group categories.
* Members can use "Other".
* Provide an optional "Suggest/Create Category" mechanism if it can be implemented cleanly.

Do not compromise authorization merely for convenience.

---

# 15. Category Budgets

The group admin should be able to set a budget for each category.

Important:

Budgets should be treated as MONTHLY budgets.

Example:

```text
Food             ₹8,000
Transportation   ₹5,000
Entertainment    ₹3,000
Shopping         ₹6,000
```

For each month, calculate:

```text
Budget
Actual Spending
Remaining
Percentage Used
```

Example:

```text
Food

Budget:     ₹8,000
Spent:      ₹6,200
Remaining:  ₹1,800
Used:       77.5%
```

The budget architecture should support future month-specific budgets.

---

# 16. Budget Status

Display useful visual indicators.

Suggested states:

### Healthy

Spending comfortably below budget.

### Warning

Spending reaches approximately 80% of budget.

### Exceeded

Spending reaches 100% or more.

Example:

```text
Food
₹6,200 / ₹8,000

77.5%
```

Use progress bars or similar visualizations.

Do not rely only on color.

Also show textual status for accessibility.

---

# 17. Personal Dashboard

Every user should have a private personal dashboard.

It should display data belonging only to that user.

Dashboard should include:

### Monthly summary

```text
Total Expenses
Number of Expenses
Average Daily Spending
```

If personal budgets are implemented, also show:

```text
Total Budget
Spent
Remaining
```

### Category breakdown

Example:

```text
Food          ₹5,200
Transport     ₹2,100
Shopping      ₹4,000
Bills         ₹3,500
```

Use a visually pleasant chart.

### Monthly expenditure

Show spending trends over time.

For example:

```text
Jan  ₹12,500
Feb  ₹15,200
Mar  ₹13,800
Apr  ₹17,100
...
```

Provide a chart.

---

# 18. Group Dashboard

Group dashboard should be visible to:

* Group admin
* Group members

It should contain:

## Monthly Summary

Display:

```text
Total Budget
Total Expenses
Remaining Budget
```

Example:

```text
September 2026

Budget          ₹50,000
Spent           ₹37,500
Remaining       ₹12,500
```

---

# 19. Category-wise Dashboard

Display:

```text
Category       Budget       Spent       Remaining
---------------------------------------------------
Food           ₹8,000       ₹6,200      ₹1,800
Travel         ₹10,000      ₹9,500      ₹500
Shopping       ₹5,000       ₹6,100      -₹1,100
```

Include percentage utilization.

Make it visually easy to identify categories that are approaching or exceeding their budgets.

---

# 20. Monthly Expenditure

Display expenditure by month.

Allow users to understand spending trends.

Example:

```text
April       ₹32,000
May         ₹28,500
June        ₹35,200
July        ₹31,700
August      ₹38,100
September   ₹25,400
```

Use a suitable chart.

The chart should be responsive.

---

# 21. Person-specific Group Spending

For group dashboards, show spending by member.

Example:

```text
Omkesh       ₹12,500
Rahul        ₹8,200
Amit         ₹6,800
Sneha        ₹4,500
```

Allow the user to understand:

* How much each person paid
* Percentage of total group spending

Later, this data can be used for settlement calculations.

---

# 22. Expense List

Provide a monthly expense list.

Each expense should display:

* Item
* Amount
* Paid by
* Category
* Payment mode
* Date
* Notes where appropriate

Example:

```text
10 Sept 2026

Groceries
₹2,450
Paid by Omkesh
Food
UPI
```

Allow:

* View
* Edit
* Delete

according to authorization rules.

---

# 23. Historical Records

Users should be able to select a month.

Example:

```text
September 2026 ▼
```

They can select:

* Current month
* Previous months
* Any month for which records exist

When changing the month, update:

* Summary
* Charts
* Category budgets
* Category spending
* Expense list
* Member spending

Do not reload the entire page unnecessarily if a smooth client/server interaction can be implemented cleanly.

---

# 24. Expense Search and Filters

Add useful filtering functionality.

Users should be able to filter expenses by:

* Category
* Paid by
* Payment mode
* Date range

Also provide search by:

* Item name
* Notes

Allow filters to be reset easily.

---

# 25. Export

Allow users to download expenses for a selected month.

At minimum support:

```text
CSV
```

The exported file should include:

* Date
* Item
* Amount
* Currency
* Paid by
* Category
* Payment mode
* Notes
* Created timestamp

Example filename:

```text
goa-trip-september-2026-expenses.csv
```

Design the architecture so XLSX/PDF export can be added later.

---

# 26. Empty States

Do not show blank screens when there is no data.

Examples:

### No expenses

```text
No expenses yet

Start tracking your spending by adding your first expense.

[ Add Expense ]
```

### No group

```text
You haven't joined any groups yet.

[ Create Group ]
```

### No invitations

```text
No invitations waiting

When someone invites you to a group, it appears here
for you to accept or decline.
```

### No records for selected month

```text
No expenses recorded for September 2026.
```

Create attractive illustrations/icons where appropriate.

---

# 27. Loading States

Use proper loading states.

Examples:

* Skeleton cards
* Skeleton expense rows
* Button loading states
* Dashboard loading states

Do not leave the user wondering whether something is loading.

---

# 28. Error Handling

Implement proper error handling.

Handle:

* Authentication failures
* Database failures
* Network errors
* Invalid input
* Unauthorized access
* Expired invitations
* Duplicate invitations
* Duplicate memberships
* Email sending failures
* Export failures

Display user-friendly messages.

Do not expose raw database errors to users.

Log useful technical information server-side where appropriate.

---

# 29. Database Design

Design a normalized PostgreSQL schema.

Potential tables:

```text
profiles
groups
group_members
group_invitations
categories
budgets
expenses
```

Potential relationships:

```text
profiles
   │
   ├── expenses
   │
   ├── groups
   │
   └── group_members
           │
           └── groups

groups
   ├── categories
   ├── budgets
   ├── expenses
   └── invitations
```

Use foreign keys.

Use appropriate indexes.

Use timestamps.

Use constraints wherever possible.

Do not rely exclusively on frontend validation.

---

# 30. Important Database Constraints

Implement appropriate constraints such as:

* Expense amount > 0
* Required fields cannot be NULL
* Group currency cannot be NULL
* A user cannot have duplicate membership in the same group
* Category belongs to the correct group
* Budget belongs to the correct group/category/month
* Invitation has a valid expiration
* Appropriate foreign key relationships

Use database constraints where they improve data integrity.

---

# 31. Supabase Row Level Security

RLS is REQUIRED.

Never rely only on frontend checks.

Users should only be able to access their own personal expenses.

For groups:

### Admin

Can:

* Read group data
* Manage group settings
* Manage categories
* Manage budgets
* Manage members/invitations
* Read group expenses

### Member

Can:

* Read groups they belong to
* Read group expenses
* Create group expenses
* Read categories
* Read budgets

Members must not be able to bypass permissions by directly calling Supabase APIs.

Carefully design and test RLS policies.

---

# 32. Security Requirements

Never expose:

* Supabase service role key
* Email provider API key
* Other secrets

to the browser.

Use environment variables.

Validate user input on the server.

Do not trust:

* User IDs
* Group IDs
* Role values
* Amounts
* Category IDs

coming from the client.

Always verify authorization server-side/database-side.

Protect invitation tokens.

Do not expose sensitive information through API responses.

---

# 33. UI / UX Design

The application should have a polished modern financial-dashboard aesthetic.

Design characteristics:

* Clean
* Minimal
* Elegant
* Modern
* Professional
* Calm
* Easy to scan

Avoid:

* Excessive gradients
* Excessive shadows
* Excessive animations
* Cluttered dashboards
* Too many colors
* Huge typography everywhere

Use a restrained color system.

Financial information should have strong visual hierarchy.

---

# 34. Suggested Application Layout

Desktop:

```text
┌──────────────────────────────────────────────────────┐
│ Logo                         Notifications   Profile │
├──────────────┬───────────────────────────────────────┤
│              │                                       │
│ Dashboard    │                                       │
│ Expenses     │          Main Content                 │
│ Groups       │                                       │
│ Categories   │                                       │
│ Reports      │                                       │
│              │                                       │
│ Settings     │                                       │
└──────────────┴───────────────────────────────────────┘
```

Mobile:

Use a responsive navigation system such as:

* Bottom navigation
* Hamburger menu
* Mobile drawer

Do not simply shrink the desktop sidebar.

---

# 35. Main Navigation

Suggested navigation:

```text
Dashboard
Expenses
Groups
Reports
Settings
```

Within groups:

```text
My Groups
  ├── Goa Trip
  ├── Flat Expenses
  └── Family
```

The UI should clearly distinguish:

```text
Personal
```

from

```text
Group
```

expenses.

Pending group invitations are reached from the top bar's notification
indicator rather than from the main navigation, so the navigation stays a list
of sections rather than a list of tasks.

---

# 36. Add Expense UX

The "Add Expense" action should be highly accessible.

Use a prominent button:

```text
+ Add Expense
```

On mobile, consider a floating action button.

The expense form should be simple and quick to use.

Recommended order:

```text
Item name
Amount
Paid by
Date
Category
Payment mode
Notes
```

Use appropriate input types.

For amount, use a numeric input.

For date, use a date picker.

For category/payment mode, use select/popover controls.

---

# 37. Dashboard Cards

Create reusable dashboard cards.

Examples:

```text
Total Budget
₹50,000

Total Spent
₹37,500

Remaining
₹12,500

Expenses
42
```

Cards should have:

* Clear title
* Large value
* Optional supporting information
* Subtle icon
* Responsive layout

---

# 38. Charts

Use a suitable chart library if required.

Suggested visualizations:

### Category spending

Donut/pie chart.

### Monthly spending

Line or bar chart.

### Member spending

Bar chart.

### Budget vs actual

Progress bars or bar chart.

Charts must remain readable on mobile.

Do not use charts simply for decoration.

---

# 39. Animations

Use Motion/Framer Motion for subtle interactions.

Examples:

* Page transitions
* Card entrance
* Modal appearance
* Dropdowns
* Toasts
* Progress bars
* Expense list changes

Animations should be quick and subtle.

Respect:

```text
prefers-reduced-motion
```

where practical.

---

# 40. Accessibility

Follow basic accessibility principles.

Ensure:

* Keyboard navigation
* Visible focus states
* Proper labels
* Semantic HTML
* Accessible dialogs
* Accessible form errors
* Sufficient contrast
* Screen-reader-friendly controls

Do not communicate important information using color alone.

---

# 41. Responsive Design

The application must work well on:

* Desktop
* Laptop
* Tablet
* Mobile

Test at common viewport sizes.

Pay special attention to:

* Expense forms
* Tables
* Charts
* Dashboard cards
* Navigation
* Modals
* Date pickers

Do not allow tables to destroy mobile layouts.

Use cards or horizontal scrolling where appropriate.

---

# 42. Project Structure

Use a clean Next.js App Router structure.

Suggested conceptual structure:

```text
src/
├── app/
│   ├── (auth)/
│   │   ├── sign-in/
│   │   └── sign-up/
│   │
│   ├── (dashboard)/
│   │   ├── dashboard/
│   │   ├── expenses/
│   │   ├── groups/
│   │   ├── reports/
│   │   └── settings/
│   │
│   ├── api/
│   │
│   └── ...
│
├── components/
│   ├── ui/
│   ├── dashboard/
│   ├── expenses/
│   ├── groups/
│   └── charts/
│
├── lib/
│   ├── supabase/
│   ├── auth/
│   ├── email/
│   ├── validations/
│   └── utils/
│
├── types/
│
└── ...
```

Adjust the structure if there is a strong architectural reason.

Do not create unnecessary folders.

---

# 43. Validation

Use a schema validation library such as Zod if appropriate.

Create schemas for:

* Sign up
* Sign in
* Expense
* Group
* Category
* Budget
* Invitation

Validation should happen:

1. Client-side for good UX.
2. Server-side for security.

Do not rely only on client-side validation.

---

# 44. Date and Currency Handling

Be extremely careful with:

* Timezones
* Dates
* Currency formatting
* Decimal values

Use ISO-compatible database representations.

Display according to the application's locale/settings.

Example:

```text
₹2,450.00
```

or appropriate currency formatting.

Do not perform financial calculations using unsafe floating-point logic where precision matters.

Use appropriate PostgreSQL numeric/decimal types.

---

# 45. Personal vs Group Expense Model

Clearly distinguish:

### Personal expense

```text
expense
  user_id = current user
  group_id = NULL
```

### Group expense

```text
expense
  group_id = selected group
  paid_by = group member
```

A group expense must belong to a valid group.

The person recorded in "Paid by" must be an active member of that group.

---

# 46. Future Settlement Feature

Do not necessarily implement this in the first MVP, but design the data model so that group settlements can later be calculated.

Future functionality:

```text
Total group spending: ₹30,000

Omkesh paid: ₹15,000
Rahul paid: ₹10,000
Amit paid: ₹5,000

Equal share: ₹10,000/person

Omkesh should receive ₹5,000
Rahul should pay ₹0
Amit should pay ₹5,000
```

This can later become:

```text
Settlement
```

feature similar to Splitwise.

Do not introduce settlement complexity into the initial MVP unless explicitly requested.

---

# 47. Reports

Create a Reports section that can eventually include:

* Monthly spending
* Category trends
* Person-wise group spending
* Payment mode breakdown
* Budget utilization
* Historical comparison

For MVP, implement only the reports necessary for the dashboard.

Keep the architecture extensible.

---

# 48. Settings

Create a settings page with sections such as:

### Profile

* Name
* Email

### Preferences

Potential future settings:

* Default currency
* Default payment mode
* Default category

### Account

* Sign out

Keep the initial settings implementation simple.

---

# 49. Testing

Implement meaningful tests.

At minimum test:

### Authentication

* Sign up
* Sign in
* Sign out
* Protected routes

### Expenses

* Create expense
* Update expense
* Delete expense
* Validation
* Correct user ownership

### Groups

* Create group
* Invite member
* Accept invitation (in the app, and from a link)
* Decline invitation
* Prevent duplicate membership
* An invitation is only usable by the address it was sent to
* An invitee cannot change the role an invitation grants

### Authorization

* User cannot access another user's personal expenses
* Non-members cannot access group data
* Members cannot modify admin-only settings

### Budgets

* Correct monthly calculations
* Correct remaining amount
* Correct percentage calculation
* Budget exceeded state

Prioritize tests around business logic and security.

---

# 50. Performance

Avoid unnecessary database queries.

Use:

* Appropriate indexes
* Efficient queries
* Server Components where appropriate
* Pagination where lists become large
* Reasonable caching/revalidation

Do not optimize prematurely.

First make the architecture correct and measurable.

---

# 51. Observability and Error Logging

Create a clean approach for handling application errors.

Do not expose stack traces to users.

Use meaningful error messages.

Make errors easy to debug during development.

Keep production secrets out of logs.

---

# 52. Environment Variables

Create:

```text
.env.local
```

and an example:

```text
.env.example
```

Potential variables:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

EMAIL_API_KEY=
EMAIL_FROM=
```

Never commit actual secrets.

---

# 53. README

Create a comprehensive README containing:

## Project Overview

What the application does.

## Tech Stack

List technologies.

## Prerequisites

What needs to be installed.

## Installation

Example:

```bash
npm install
```

## Environment Setup

Explain `.env.local`.

## Supabase Setup

Explain:

* Creating Supabase project
* Running migrations
* Configuring authentication
* Configuring RLS

## Email Setup

Explain provider configuration.

## Development

```bash
npm run dev
```

## Production Build

```bash
npm run build
npm start
```

## Testing

Explain how to run tests.

---

# 54. Git-Friendly Development

Make logical commits after each major phase.

Suggested commits:

```text
feat: initialize nextjs application
feat: add supabase authentication
feat: add database schema
feat: add personal expenses
feat: add group management
feat: add group invitations
feat: add categories and budgets
feat: add dashboard
feat: add expense filters
feat: add exports
feat: improve responsive ui
test: add authorization tests
```

Do not mix unrelated changes into a single commit.

---

# 55. MVP Scope

The first production-capable MVP should contain:

### Authentication

* Sign up
* Sign in
* Sign out
* Persistent sessions

### Personal expenses

* Create
* Read
* Update
* Delete

### Groups

* Create
* Invite
* In-app invitations: accept or decline
* Join
* View members

### Group expenses

* Create
* Read
* Update
* Delete
* Paid-by member selection

### Categories

* Default categories
* Group categories
* Custom categories

### Budgets

* Monthly category budgets
* Budget vs actual
* Remaining budget
* Budget utilization

### Dashboards

* Personal dashboard
* Group dashboard
* Category spending
* Monthly spending
* Member spending

### History

* Month selector
* Historical expenses

### Export

* CSV

### Security

* Supabase RLS
* Proper authorization

### UX

* Responsive design
* Toasts
* Loading states
* Empty states
* Error states
* Subtle animations

---

# 56. Features to Keep for Later

Do NOT complicate the MVP with all of the following initially:

* Expense splitting algorithms
* Settlement payments
* Recurring expenses
* Multiple currencies within one group
* OCR receipt scanning
* Receipt image uploads
* Bank account integration
* Automatic transaction imports
* AI expense categorization
* Advanced analytics
* Push notifications
* Mobile native applications

Keep the architecture extensible so these can be added later.

---

# 57. Important UX Enhancement: Quick Expense Entry

Design the application so entering an expense is extremely fast.

The ideal flow should feel like:

```text
+ Add Expense

Item:        Groceries
Amount:      ₹1,250
Paid by:     Omkesh
Date:        2 Sept 2026
Category:    Groceries
Payment:     UPI
Notes:       Weekly shopping

[ Save Expense ]
```

After saving:

```text
✓ Expense added successfully
```

The dashboard/list should update appropriately.

---

# 58. Important UX Enhancement: Month Context

The selected month should be clearly visible throughout the dashboard.

Example:

```text
September 2026
```

with:

```text
‹     September 2026     ›
```

or a month picker.

When the user changes the month, all relevant dashboard information should update consistently.

---

# 59. Important UX Enhancement: Group Context

When working inside a group, clearly show:

```text
Group: Goa Trip 2026
Currency: INR
```

The user should never be confused about which group they are currently viewing.

---

# 60. Final Quality Requirements

Before considering the project complete, verify:

### Functional

* All core features work.
* Personal expenses are private.
* Group expenses are accessible only to group members.
* Admin permissions work.
* Budgets calculate correctly.
* Monthly filtering works.
* Export works.

### Security

* RLS policies are implemented.
* Unauthorized users cannot access protected data.
* Secrets are not exposed.
* Server-side validation exists.

### UI

* Responsive on mobile.
* Responsive on desktop.
* No obvious layout problems.
* Loading states exist.
* Empty states exist.
* Errors are understandable.
* Toast notifications work.
* Animations are subtle.

### Code

* TypeScript strict mode.
* No unnecessary `any`.
* Components are reusable.
* Business logic is separated appropriately.
* No duplicated code unnecessarily.
* Environment variables are documented.

### Production readiness

* Build succeeds.
* Lint succeeds.
* Tests pass.
* README is complete.
* Database migrations are reproducible.

---

# 61. Most Important Instruction: Build Step by Step

DO NOT implement everything at once.

Break the project into the following phases:

## Phase 1 — Project foundation

Set up:

* Next.js
* TypeScript
* Tailwind
* UI components
* ESLint
* Basic project structure
* Environment configuration
* Git setup

Do not build business features yet.

---

## Phase 2 — Supabase + Authentication

Implement:

* Supabase connection
* Database foundation
* User profiles
* Sign up
* Sign in
* Sign out
* Persistent sessions
* Protected routes

Verify everything before proceeding.

---

## Phase 3 — Database Schema + RLS

Create:

* profiles
* groups
* group_members
* group_invitations
* categories
* budgets
* expenses

Implement:

* Foreign keys
* Constraints
* Indexes
* RLS policies

Test authorization thoroughly.

---

## Phase 4 — Personal Expense Tracking

Implement:

* Add expense
* Expense list
* Edit
* Delete
* Categories
* Payment modes
* Date selection
* Notes
* Timestamp

Create a clean personal dashboard.

---

## Phase 5 — Groups

Implement:

* Create group
* Select currency
* Group details
* Member list
* Admin/member roles
* Invitations
* In-app invitations, with accept and decline
* In-app notification count for pending invitations
* Invitation acceptance
* Email integration (optional fallback for users without an account)

---

## Phase 6 — Group Expenses

Implement:

* Group expense creation
* Paid-by selection
* Group categories
* Expense list
* Edit/delete permissions
* Group expense filtering

---

## Phase 7 — Categories + Budgets

Implement:

* Default categories
* Custom categories
* Category management
* Monthly budgets
* Budget vs actual
* Remaining budget
* Budget utilization

---

## Phase 8 — Dashboards

Implement:

* Personal dashboard
* Group dashboard
* Monthly summary
* Category breakdown
* Monthly expenditure
* Member expenditure
* Budget charts

---

## Phase 9 — Search, Filters + History

Implement:

* Month selector
* Search
* Category filter
* Payment mode filter
* Person filter
* Date range filter
* Historical records

---

## Phase 10 — Export

Implement:

* Monthly CSV export
* Proper filename
* Correct currency/date formatting

---

## Phase 11 — UI Polish

Improve:

* Colors
* Typography
* Spacing
* Cards
* Charts
* Animations
* Mobile navigation
* Loading states
* Empty states
* Error states
* Accessibility

Do not redesign the entire application unnecessarily.

---

## Phase 12 — Testing + Security Audit

Test:

* Authentication
* RLS
* Authorization
* Expenses
* Groups
* Invitations
* Budgets
* Dashboard calculations
* Export

Attempt unauthorized access deliberately.

Fix every discovered issue.

---

## Phase 13 — Production Readiness

Verify:

```bash
npm run lint
npm run build
npm test
```

where applicable.

Review:

* Environment variables
* Database migrations
* RLS
* Error handling
* Performance
* Responsive design
* README

Only consider the MVP complete after all checks pass.

---

# 62. How You Should Work With Me

Do not jump directly to Phase 2, 3, or later.

Start with **Phase 1 only**.

Before making changes:

1. Inspect the existing project.
2. Understand the current file structure.
3. Identify what already exists.
4. Explain briefly what you intend to change.
5. Implement only the current phase.
6. Show the important files/changes.
7. Run appropriate checks.
8. Report any issues.
9. Stop and wait for my confirmation before moving to the next phase.

I want to develop this project incrementally and understand what is being built.

Do not silently implement future phases.

If a decision is required that affects the database architecture or future functionality, explain the trade-offs and ask before making an irreversible architectural decision.

---

# 63. Definition of Done

The project is considered successful when a normal user can:

1. Sign up.
2. Sign in.
3. Stay signed in after refreshing the browser.
4. Add personal expenses.
5. View personal monthly spending.
6. Create a group.
7. Select the group's currency.
8. Configure categories.
9. Set monthly category budgets.
10. Invite other users.
11. Have those users see the invitation in the application and accept or
    decline it, without needing an email.
12. Have invited users join the group.
13. Add group expenses.
14. Select which group member paid.
15. View group spending.
16. View spending by category.
17. View spending by member.
18. Compare budget vs actual.
19. Navigate between months.
20. Search/filter expenses.
21. View historical expenses.
22. Download monthly expense data.
23. Sign out.

At all times, users must only see data they are authorized to see.

The final product should feel like a polished, modern expense-management application rather than a tutorial project.
