Build a small team expense-approval service.

Must have:
- a signed-in user can submit an expense claim: amount, currency, date, category, note
- a named approver can approve or reject a claim, with a reason recorded on a rejection
- every claim keeps an audit trail: who did what, when, and what changed
- a claimant sees only their own claims; an approver sees their team's
- a monthly summary per person: total submitted, total approved, total rejected
- the service remembers users between sessions

Not doing: no payments, no bank connections, no mobile app, no email sending,
no receipt image upload, no multi-currency conversion rates fetched from anywhere.

It handles personal financial data, so it must store nothing in plain text that
would embarrass anyone if the database leaked, and it must not log claim amounts.

It integrates with two things: a local SQLite database for storage, and the
operating system's own clock and locale for dates and currency formatting.

Use TypeScript throughout, with strict type checking on. Use Node.js with its
built-in test runner. Build it in phases: get one claim submitted and approved
end to end before adding the audit trail, the permissions or the summary.
