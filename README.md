# ShoppingList

> רשימת קניות שיתופית בזמן אמת — React + Supabase

A real-time collaborative shopping list app with Hebrew/RTL support, product catalog integration, department grouping, and Israeli supermarket price sync.

---

## Features

- **Multiple lists** — create, switch between, and share lists with other users
- **Real-time sync** — all changes reflect instantly across devices via Supabase Realtime
- **Product catalog** — link items to a barcode catalog for accurate pricing; auto-links on add
- **Estimated + cart totals** — footer shows estimated cost of remaining items and a subtotal for checked ones
- **Department grouping** — items auto-grouped by supermarket department (produce, dairy, etc.) with drag-and-drop reordering
- **Swipe to delete** — mobile-friendly swipe gesture on each row; 7-second undo via toast
- **Quantity controls** — compact `−[n]+` inline controls per item
- **Checkout flow** — mark items as purchased, log to purchase history
- **Retail price sync** — background sync from Israeli chain XML feeds (Shufersal, Rami Levy, Yohananof, etc.) via GitHub Actions → Supabase Edge Function
- **Sharing** — invite collaborators by email with owner / editor roles
- **Auth** — Google OAuth + email magic link via Supabase Auth

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Tailwind CSS |
| Backend / DB | Supabase (Postgres, Realtime, Edge Functions) |
| Auth | Supabase Auth — Google OAuth + PKCE |
| Drag & Drop | @dnd-kit |
| Mobile gestures | react-swipeable |
| Build | Vite 8 |
| Unit tests | Vitest + Testing Library |
| E2E tests | Playwright |

---

## Getting Started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project

### Setup

```bash
git clone https://github.com/avitantal/ShoppingList.git
cd ShoppingList
npm install
```

Create a `.env.local` file:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

Run the Supabase migrations from `supabase/migrations/` against your project, then:

```bash
npm run dev
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | TypeScript check + Vite build |
| `npm run test` | Unit tests (Vitest watch) |
| `npm run test:run` | Unit tests (single run, verbose) |
| `npm run e2e` | End-to-end tests (Playwright) |
| `npm run lint` | ESLint |

---

## Project Structure

```
src/
├── components/       # UI components (ItemRow, ActiveList, CartTotalFooter, …)
├── hooks/            # React hooks (useListItems, useProductSearch, …)
├── lib/              # Supabase client, utils, department lookup
└── test/             # Unit + integration tests

supabase/
├── functions/        # Edge Functions (refresh-products ingest)
└── migrations/       # SQL migrations

docs/
└── superpowers/      # Design specs and implementation plans
```

---

## Data Model

All tables live in the `shopping` Postgres schema:

- **shopping_lists** — list metadata, owner, department order
- **list_members** — sharing / collaborators (owner | editor)
- **list_items** — items with barcode, qty, estimated price, in-cart flag
- **products** — catalog (barcode → name, price, department, chain)
- **purchase_history** — completed checkout sessions

---

## Retail Price Sync

A GitHub Actions cron job downloads XML price feeds from Israeli supermarket chains and POSTs them to a Supabase Edge Function (`refresh-products`), which upserts into the `products` table. Items linked to a barcode display the latest synced price.

---

## License

Private — all rights reserved.
