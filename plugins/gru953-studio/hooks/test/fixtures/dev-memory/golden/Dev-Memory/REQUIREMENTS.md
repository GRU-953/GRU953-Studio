# Requirements — Habit Tracker (Standard Tier)

| ID | Requirement | Phase | Tasks | Verification | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| R1 | Users can create, edit and delete a habit | 1 | T1 | `npm test -- habit.test.js` -> exit 0 (2026-07-20) | met |
| R2 | Users can check in on a habit once per day | 1 | T2 | `npm test -- checkin.test.js` -> exit 0 (2026-07-21) | met |
| R3 | Users see their current streak update live | 2 | T3 | pending | todo |
| R4 | Users get a reminder if they haven't checked in | 2 | T4 | pending | todo |
| R5 | Export habit history to CSV | 3 | — | — | deferred |
