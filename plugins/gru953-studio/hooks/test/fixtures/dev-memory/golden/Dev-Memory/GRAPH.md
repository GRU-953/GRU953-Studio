# Knowledge Graph — Habit Tracker

## Nodes
- [R1] requirement: users can create, edit and delete a habit {tags: crud}
- [R2] requirement: users can check in on a habit once per day {tags: checkin}
- [R3] requirement: users see their current streak update live {tags: streak}
- [T1] task: add habit CRUD {tags: crud, phase1}
- [T2] task: daily check-in UI {tags: checkin, phase1}
- [T3] task: wire streak counter to check-in event {tags: streak, phase2}
- [D1] decision: store all dates in UTC to avoid timezone streak bugs

## Links
- T1 implements R1
- T2 implements R2
- T3 implements R3
- D1 relates-to T3
