import { createHash } from "node:crypto";

// Explicit demonstration content, never a fallback for failed live queries.
export const casaMesaRestaurant = "11111111-1111-4111-8111-111111111111";
export const casaMesaProject = "ahkleoidhzcsubsdlqbn.supabase.co";
export const photoLicense = "https://unsplash.com/license";

// Stable, tenant-scoped IDs make interrupted/repeated runs create-only.
function id(key) {
  const bytes = createHash("sha1").update(`${casaMesaRestaurant}:complete-menu-v1:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const categories = {
  starters: "33333333-3333-4333-8333-333333333331",
  mains: "33333333-3333-4333-8333-333333333332",
  desserts: "33333333-3333-4333-8333-333333333333",
  drinks: "33333333-3333-4333-8333-333333333334",
};
const single = (name, options, required = true) => ({ name, options, required, multiple: false });
const extras = (name, options, max = options.length) => ({ name, options, required: false, multiple: true, max });
const dishes = [
  ["bread", "starters", "House bread & olives", 450,
    "Rustic sourdough, marinated olives and extra virgin olive oil. Made for sharing.",
    ["Sourdough bread", "Olives", "Olive oil", "Rosemary"], ["Wheat"], ["plant-based"], []],
  ["bruschetta", "starters", "Tomato & basil bruschetta", 650,
    "Toasted sourdough with ripe tomatoes, fresh basil and a drizzle of olive oil.",
    ["Sourdough bread", "Tomato", "Basil", "Garlic", "Olive oil"], ["Wheat", "Milk (optional burrata)"], ["vegetarian"],
    [extras("Make it yours", [["Add burrata", 250]], 1)]],
  ["burrata", "starters", "Burrata & roasted tomatoes", 950,
    "Creamy burrata, sweet roasted tomatoes, basil and balsamic dressing.",
    ["Burrata", "Tomatoes", "Basil", "Olive oil", "Balsamic vinegar"], ["Milk", "Sulphites"], ["vegetarian"], []],
  ["soup", "starters", "Tomato & poached egg soup", 600,
    "Slow-roasted tomato soup with a poached egg and fresh herbs.",
    ["Tomato", "Poached egg", "Onion", "Garlic", "Vegetable stock", "Fresh herbs", "Olive oil"], ["Egg", "Celery", "Wheat (optional croutons)"], ["vegetarian"],
    [extras("Finish your soup", [["Add sourdough croutons", 50]], 1)]],
  ["fries", "starters", "Parmesan & herb fries", 550,
    "Golden fries tossed with parmesan, parsley and a touch of garlic. A side to share.",
    ["Potatoes", "Parmesan", "Parsley", "Garlic", "Sunflower oil"], ["Milk"], [], []],
  ["burger", "mains", "Casa smash burger", 1650,
    "Smashed beef, melted cheddar, lettuce, tomato and house sauce in a soft brioche bun. Served with your choice of side.",
    ["Beef", "Brioche bun", "Cheddar", "Lettuce", "Tomato", "Onion", "House sauce"], ["Wheat", "Milk", "Egg", "Mustard"], ["house-favorite"],
    [single("Choose your side", [["Fries", 0], ["Mixed leaf salad", 0]]), extras("Add a little extra", [["Crispy bacon", 200], ["Extra cheddar", 150], ["Fried egg", 150]], 3)]],
  ["salmon", "mains", "Grilled salmon & greens", 2300,
    "Grilled salmon with seasonal greens and lemon olive oil. Choose roast potatoes or extra greens on the side.",
    ["Salmon", "Seasonal greens", "Potatoes", "Lemon", "Olive oil"], ["Fish"], ["chef-selection"],
    [single("Choose your side", [["Roast potatoes", 0], ["Extra greens", 0]])]],
  ["chicken", "mains", "Lemon & herb chicken", 1800,
    "Tender grilled chicken with lemon, rosemary, roasted potatoes and a crisp green salad.",
    ["Chicken", "Lemon", "Rosemary", "Garlic", "Potatoes", "Mixed leaves", "Olive oil"], [], [],
    [single("Extra sauce", [["Lemon & herb sauce", 0], ["Chilli sauce", 0]], false)]],
  ["pesto", "mains", "Basil pesto farfalle", 1800,
    "Farfalle tossed with basil pesto, cherry tomatoes and vegetarian hard cheese.",
    ["Farfalle pasta", "Basil", "Pine nuts", "Cherry tomatoes", "Vegetarian hard cheese", "Olive oil", "Garlic"], ["Wheat", "Milk", "Pine nuts"], ["vegetarian"],
    [extras("Finish your pasta", [["Extra cheese", 150]], 1)]],
  ["steak", "mains", "Grilled sirloin steak", 2500,
    "Grilled sirloin with golden fries, a green salad and herb butter. Cooked to your preference.",
    ["Beef sirloin", "Potatoes", "Mixed leaves", "Butter", "Parsley", "Garlic"], ["Milk"], [],
    [single("How would you like your steak?", [["Rare", 0], ["Medium rare", 0], ["Medium", 0], ["Well done", 0]])]],
  ["cheesecake", "desserts", "Berry cheesecake", 700,
    "Creamy baked cheesecake on a biscuit base, finished with a generous berry compote.",
    ["Cream cheese", "Cream", "Eggs", "Butter", "Wheat biscuits", "Sugar", "Mixed berries"], ["Milk", "Egg", "Wheat"], ["vegetarian"], []],
  ["brownie", "desserts", "Dark chocolate cake", 700,
    "A rich slice of dark chocolate cake with silky chocolate frosting.",
    ["Dark chocolate", "Wheat flour", "Eggs", "Butter", "Sugar", "Cream"], ["Milk", "Egg", "Wheat", "Soy"], ["vegetarian"],
    [extras("Something on the side", [["Vanilla ice cream", 150]], 1)]],
  ["tiramisu", "desserts", "Classic tiramisu", 750,
    "Layers of espresso-soaked sponge and mascarpone cream, dusted with cocoa. Our demonstration recipe contains no alcohol.",
    ["Mascarpone", "Eggs", "Sponge biscuits", "Espresso", "Sugar", "Cocoa"], ["Milk", "Egg", "Wheat"], ["vegetarian"], []],
  ["icecream", "desserts", "Chocolate & vanilla sundae", 650,
    "Chocolate and vanilla ice cream, chocolate sauce, whipped cream and a hazelnut crunch.",
    ["Chocolate ice cream", "Vanilla ice cream", "Chocolate sauce", "Whipped cream", "Hazelnuts"], ["Milk", "Egg", "Hazelnuts", "Soy"], ["vegetarian"], []],
  ["water", "drinks", "Mineral water · 50 cl", 250,
    "Chilled mineral water, still or sparkling.", ["Mineral water"], [], ["plant-based"],
    [single("Still or sparkling?", [["Still", 0], ["Sparkling", 50]])]],
  ["orange", "drinks", "Fresh orange juice", 450,
    "Freshly squeezed orange juice, served chilled. 25 cl.", ["Oranges"], [], ["plant-based"], []],
  ["lemonade", "drinks", "House lemonade", 450,
    "Fresh lemon and lime juice with mint, a little sugar and plenty of ice. 30 cl.",
    ["Lemon", "Lime", "Mint", "Water", "Sugar"], [], ["plant-based"], []],
  ["espresso", "drinks", "Espresso", 200,
    "A short, aromatic coffee to finish your meal. Regular or decaffeinated.", ["Coffee", "Water"], [], ["plant-based"],
    [single("Your coffee", [["Regular", 0], ["Decaffeinated", 0]])]],
  ["tea", "drinks", "Lemon iced tea", 400,
    "Freshly brewed black tea with lemon, a little sugar and ice. 30 cl.",
    ["Black tea", "Lemon", "Water", "Sugar"], [], ["plant-based"], []],
  ["wine", "drinks", "House wine · glass", 550,
    "A 15 cl glass of the house wine. Choose red, white or rosé. Contains alcohol.",
    ["Wine"], ["Sulphites"], [],
    [single("Choose your wine", [["Red", 0], ["White", 0], ["Rosé", 0]])]],
];

// Unsplash License; illustrative photographs, not real Casa Mesa portions.
const photos = {
  bread: "photo-1509440159596-0249088772ff",
  bruschetta: "photo-1572695157366-5e585ab2b69f",
  burrata: "photo-1753791320863-bda47c67cd00",
  soup: "photo-1695960682129-d35477676196",
  fries: "photo-1573080496219-bb080dd4f877",
  burger: "photo-1568901346375-23c9450c58cd",
  salmon: "photo-1467003909585-2f8a72700288",
  chicken: "photo-1567121938596-6d9d015d348b",
  pesto: "photo-1473093295043-cdd812d0e601",
  steak: "photo-1558030006-450675393462",
  cheesecake: "photo-1533134242443-d4fd215305ad",
  brownie: "photo-1606313564200-e75d5e30476c",
  tiramisu: "photo-1571877227200-a0d98ea607e9",
  icecream: "photo-1563805042-7684c019e1cb",
  water: "photo-1548839140-29a749e1cf4d",
  orange: "photo-1613478223719-2ab802602423",
  lemonade: "photo-1651993737174-6890c1daef5b",
  espresso: "photo-1510707577719-ae7c14805e3a",
  tea: "photo-1556679343-c7306c1976bc",
  wine: "photo-1510812431401-41d2bd2722f3",
};

export const casaMesaAdditions = dishes.map(([key, category, name, price, description, ingredients, allergens, tags, groups]) => ({
  id: id(`product:${key}`),
  uploadId: id(`photo:${key}`),
  photo: `https://images.unsplash.com/${photos[key]}?fit=crop&w=1200&q=85&fm=jpg`,
  definition: {
    name, description: `${description}\n\nDemonstration recipe and illustrative photo. Confirm ingredients and allergens with staff.`,
    category_id: categories[category], price_minor: price, ingredients, allergens,
    dietary_tags: tags, is_available: true, status: "published",
    keep_legacy_image: false, image_asset_id: null, model_asset_id: null,
    model_usdz_asset_id: null, model_poster_asset_id: null,
    model_verified: false, model_ar_enabled: false,
    review: { license: "", provenance: "", measurement_notes: "", confirmed: false },
    groups: groups.map((g, i) => ({
      id: id(`${key}:group:${i}`), name: g.name, description: "",
      selection_type: g.multiple ? "multiple" : "single",
      min_selections: g.required ? 1 : 0, max_selections: g.multiple ? g.max : 1,
      is_active: true,
      options: g.options.map(([name, price], j) => ({
        id: id(`${key}:group:${i}:option:${j}`), name,
        price_adjustment_minor: price, is_available: true,
      })),
    })),
  },
}));
