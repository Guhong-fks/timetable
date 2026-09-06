Completed the course card text wrapping change:

1. Removed `ellipsizeMode="clip"` from course name and location text in `renderCourseCard` (lines 123-126)
2. Course name and location will now wrap to multiple lines instead of being truncated
3. Left side already displays "第几节" (period numbers) via `periodNumber` in `timeCell`
4. Top already displays "周几" (weekday labels) via `dayLabel` in `dayHead`
5. Card has `overflow: 'visible'` so wrapped text is fully displayed