# 🛒 ShoppingList

**The smartest shopping list for Israeli supermarkets.**  
Real-time collaborative lists that know the price of everything before you leave home.

[![Version](https://img.shields.io/badge/version-0.26.0-6366f1?style=flat-square)](package.json)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react)](https://react.dev)
[![Supabase](https://img.shields.io/badge/Supabase-realtime-3ecf8e?style=flat-square&logo=supabase)](https://supabase.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6?style=flat-square&logo=typescript)](https://typescriptlang.org)

---

## What makes it special

### 💰 Live prices from Israeli supermarkets
Items you add are automatically matched against a product catalog synced daily from official XML price feeds — Shufersal, Rami Levy, Yohananof, and more. You see the real shelf price before you even get to the store. The footer shows two running totals: **estimated cost of what's left** + **subtotal for what's already in the cart**.

### 🏪 Supermarket-style department grouping
Items auto-sort by department (produce, dairy, bakery…), exactly how a store is laid out. Drag departments into the order *your* store is arranged — the order is saved per list and applied automatically on your next visit.

### 👨‍👩‍👧 Truly collaborative
Share a list with your partner or housemates. Changes appear in real time on every device — no refresh needed. Role-based access: owners control sharing, editors just shop.

### 📱 Built for mobile
- Swipe left on any item to delete (with a 7-second undo)
- Long-press an item to reassign its department
- Compact `−[n]+` quantity controls that don't crowd the item name
- Full Hebrew RTL layout throughout

### 🧠 Learns your habits
Two ways the app gets smarter over time:

- **Product memory** — the first time you link a free-text item to a catalog product, that connection is saved. Next list, the same item auto-fills with name, barcode, and price — no searching.
- **Department order** — drag departments to match your store's layout. The app also *learns automatically*: after a few checkouts it analyses the order you check off items and suggests reordering the sections to match your real walking route. One tap to accept.

---

## Screenshots

> _Coming soon_

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

Create `.env.local`:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

Apply the migrations in `supabase/migrations/` to your project, then:

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
├── functions/        # Edge Functions — retail price ingest
└── migrations/       # SQL schema

docs/superpowers/     # Design specs and implementation plans
```

---

## Data Model

All tables live in the `shopping` Postgres schema:

| Table | Purpose |
|-------|---------|
| `shopping_lists` | List metadata, owner, department order |
| `list_members` | Sharing — owner / editor roles |
| `list_items` | Items with barcode, qty, estimated price, in-cart flag |
| `products` | Catalog — barcode → name, price, department, chain |
| `purchase_history` | Completed checkout sessions |

---

## Retail Price Sync

A GitHub Actions cron job fetches XML price feeds published by Israeli chains (as mandated by the Transparency Law), normalises them, and POSTs to a Supabase Edge Function (`refresh-products`) that upserts into `products`. Each run is idempotent and deduplicates by barcode.

---

---

<div dir="rtl">

# 🛒 ShoppingList — עברית

**רשימת הקניות החכמה לסופרים הישראלים.**  
רשימות שיתופיות בזמן אמת שיודעות מה עולה כל מוצר — עוד לפני שיצאת מהבית.

---

## מה מייחד אותה

### 💰 מחירים חיים מהסופרמרקטים
כשמוסיפים מוצר, האפליקציה מחפשת אותו אוטומטית בקטלוג המוצרים שמסונכרן מדי יום מקובצי ה-XML הרשמיים של שופרסל, רמי לוי, יוחננוף ועוד. רואים את מחיר המדף האמיתי לפני שמגיעים לחנות. ה-Footer מציג שני סכומים: **סה״כ משוער לשאר הקנייה** + **סה״כ ביניים למה שכבר בעגלה**.

### 🏪 מיון לפי מחלקות הסופר
פריטים ממוינים אוטומטית לפי מחלקה (ירקות, מוצרי חלב, מאפייה...) — בדיוק כמו שהחנות בנויה. גוררים את המחלקות לפי הסדר שמתאים לסופר שלכם, והסדר נשמר לכל רשימה בנפרד ומיושם אוטומטית בביקור הבא.

### 👨‍👩‍👧 שיתוף אמיתי
משתפים רשימה עם בן/בת זוג או בני הבית. שינויים מופיעים בזמן אמת בכל המכשירים. הרשאות לפי תפקיד: בעלים מנהלים שיתוף, עורכים קונים.

### 📱 בנוי למובייל
- מגלל שמאלה על פריט — מחיקה (עם ביטול ל-7 שניות)
- לחיצה ארוכה — שינוי מחלקה
- כפתורי כמות קומפקטיים `−[n]+` שלא גוזלים מקום משם המוצר
- ממשק עברי RTL מלא

### 🧠 לומד את ההרגלים שלכם
שתי דרכים שבהן האפליקציה מתחכמת עם הזמן:

- **זיכרון מוצרים** — בפעם הראשונה שמקשרים פריט-טקסט למוצר בקטלוג, הקישור נשמר. ברשימה הבאה, הפריט מתמלא אוטומטית עם שם, ברקוד ומחיר — בלי חיפוש.
- **סדר מחלקות** — גוררים את המחלקות לפי הסדר שמתאים לסופר שלכם. האפליקציה גם **לומדת אוטומטית**: לאחר כמה קניות היא מנתחת את הסדר שבו סימנתם מוצרים ומציעה לעדכן את סדר המחלקות בהתאם למסלול האמיתי שלכם בחנות. לחיצה אחת לאישור.

---

## התחלה מהירה

```bash
git clone https://github.com/avitantal/ShoppingList.git
cd ShoppingList
npm install
```

צרו קובץ `.env.local`:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

הריצו את ה-migrations מ-`supabase/migrations/` על הפרויקט ב-Supabase, ואז:

```bash
npm run dev
```

</div>

---

## License

Private — all rights reserved.
