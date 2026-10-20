# Casa Mesa demonstration menu

The live Casa Mesa menu has 24 published items across four existing categories:
six starters, eight mains, four desserts and six drinks. The original salmon
eggs, tomato pasta, garden bowl and Yakitori Momo keep their IDs and settings.
The unrelated existing `cozido` draft is left untouched.

The 20 additions are explicit demonstration recipes, prices, ingredients and
allergen declarations. They are editable through **Admin → Edit menu**. They
are not a real restaurant's verified recipes or portions. Staff must check the
recipes, ingredients, allergens, cross-contact precautions and prices before
using them for actual service. Each new product says that its photograph is
illustrative. No new 3D models or AR approvals are attached.

## Repeatable development content workflow

The catalog is in `scripts/data/casa-mesa-menu.mjs`. It is separate from the
offline demo fixture and is never imported by customer pages. There is no
automatic seeding or failed-query fallback.

Use Node.js 24 with the existing ignored local public Supabase configuration
and `STAFF_TEST_EMAIL` / `STAFF_TEST_PASSWORD` for an authorized Casa Mesa owner
or manager. Do not put credentials in command arguments or source files.

```sh
# Preview only: verifies ordinary staff identity and manager workspace access.
node --env-file=.env.local scripts/complete-casa-mesa-menu.mjs

# Start the existing live app locally, e.g. on http://127.0.0.1:3200.
# Its server-only media upload configuration must already be working.
MENU_COMPLETION_ORIGIN=http://127.0.0.1:3200 \
  node --env-file=.env.local scripts/complete-casa-mesa-menu.mjs --apply
```

The script is restricted to development project `ahkleoidhzcsubsdlqbn` and the
existing Casa Mesa restaurant/category IDs. It uses verified owner/manager
sessions and the existing transactional menu RPCs. It does not read a privileged
key. Photographs pass through the normal authenticated byte-validation upload
gateway, which optimizes them as WebP in immutable tenant/product Storage paths.

Products have stable IDs. An existing ID or matching name is skipped, preserving
subsequent manager edits. Each new item is saved as a draft before its photograph
is uploaded and is published only after upload succeeds. If interrupted, a draft
or unattached upload may remain in the administration workspace; inspect and
finish that item there. Re-running does not overwrite drafts or duplicate them.
The script does not reopen a restaurant, create sessions or orders, or modify
historical records. It compares historical order-item snapshots and pre-existing
products before and after the operation. Concurrent legitimate edits may require
reviewing that verification result.

## Illustrative photography credits

Downloaded from Unsplash on 2026-10-20 under the
[Unsplash License](https://unsplash.com/license). Photographs illustrate the
demonstration menu; they do not depict actual Casa Mesa dishes. Exact bounded
download URLs are recorded in the catalog. Replace with restaurant-owned
photographs before a real pilot.

- [Rustic bread](https://images.unsplash.com/photo-1509440159596-0249088772ff).
- [Tomato bruschetta](https://images.unsplash.com/photo-1572695157366-5e585ab2b69f).
- [Burrata and tomatoes](https://unsplash.com/photos/burrata-cheese-with-tomatoes-and-basil-kkAW965TiPk).
- [Tomato soup](https://unsplash.com/photos/a-bowl-of-tomato-soup-with-bread-on-the-side-RhiTquS8jbI).
- [Parmesan fries](https://images.unsplash.com/photo-1573080496219-bb080dd4f877).
- [Burger](https://images.unsplash.com/photo-1568901346375-23c9450c58cd).
- [Grilled salmon](https://images.unsplash.com/photo-1467003909585-2f8a72700288).
- [Grilled chicken](https://unsplash.com/photos/grilled-chicken-dish-46i7Fqy4bto).
- [Pesto pasta](https://images.unsplash.com/photo-1473093295043-cdd812d0e601).
- [Grilled steak](https://images.unsplash.com/photo-1558030006-450675393462).
- [Berry cheesecake](https://images.unsplash.com/photo-1533134242443-d4fd215305ad).
- [Chocolate cake](https://images.unsplash.com/photo-1606313564200-e75d5e30476c).
- [Tiramisu](https://images.unsplash.com/photo-1571877227200-a0d98ea607e9).
- [Ice cream sundae](https://images.unsplash.com/photo-1563805042-7684c019e1cb).
- [Water](https://images.unsplash.com/photo-1548839140-29a749e1cf4d).
- [Orange juice](https://images.unsplash.com/photo-1613478223719-2ab802602423).
- [Lemonade](https://unsplash.com/photos/a-glass-of-lemonade-with-limes-and-limes-U4mCZiti-aM).
- [Espresso](https://images.unsplash.com/photo-1510707577719-ae7c14805e3a).
- [Iced tea](https://images.unsplash.com/photo-1556679343-c7306c1976bc).
- [Wine](https://images.unsplash.com/photo-1510812431401-41d2bd2722f3).
