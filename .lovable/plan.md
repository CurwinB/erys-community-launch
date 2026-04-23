

# Add pagination to homepage launch feeds

Add pagination controls to both live and completed launches sections on the homepage. Show 20 launches per page with previous/next navigation.

## Changes to `src/pages/Index.tsx`

### 1. Add imports and pagination state

Import `useState` and `useEffect` from React. Add two separate pagination states:

```typescript
const [currentPage, setCurrentPage] = useState(1);
const [completedPage, setCompletedPage] = useState(1);
const LAUNCHES_PER_PAGE = 20;
```

### 2. Add useEffect hooks to reset pagination

Reset to page 1 when the respective launch data changes:

```typescript
useEffect(() => {
  setCurrentPage(1);
}, [liveLaunches?.length]);

useEffect(() => {
  setCompletedPage(1);
}, [completedLaunches?.length]);
```

### 3. Paginate live launches

After fetching `liveLaunches`, compute paginated subset:

```typescript
const totalPages = Math.ceil((liveLaunches?.length || 0) / LAUNCHES_PER_PAGE);
const paginatedLaunches = liveLaunches?.slice(
  (currentPage - 1) * LAUNCHES_PER_PAGE,
  currentPage * LAUNCHES_PER_PAGE
) || [];
```

Replace `liveLaunches.map` with `paginatedLaunches.map` in the grid render.

### 4. Add live launches pagination controls

Below the live launches grid, add pagination UI when `totalPages > 1`:

```tsx
<div className="flex items-center justify-between border border-border bg-card px-4 py-3 mt-6">
  <button
    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
    disabled={currentPage === 1}
    className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
  >
    ← Previous
  </button>
  <span className="font-mono text-xs text-muted-foreground">
    Page {currentPage} of {totalPages} · {liveLaunches?.length || 0} launches
  </span>
  <button
    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
    disabled={currentPage === totalPages}
    className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
  >
    Next →
  </button>
</div>
```

### 5. Paginate completed launches

Apply the same pattern to completed launches with separate state:

```typescript
const totalCompletedPages = Math.ceil((completedLaunches?.length || 0) / LAUNCHES_PER_PAGE);
const paginatedCompleted = completedLaunches?.slice(
  (completedPage - 1) * LAUNCHES_PER_PAGE,
  completedPage * LAUNCHES_PER_PAGE
) || [];
```

Replace `completedLaunches.map` with `paginatedCompleted.map`.

### 6. Add completed launches pagination controls

Add identical pagination UI below the completed launches grid using `completedPage` state.

### 7. Remove completed launches limit

Change the `completedLaunches` query to remove the `.limit(6)` so all completed launches are fetched and can be paginated.

## Files edited

- `src/pages/Index.tsx` — add imports, state, pagination logic, and controls

