import type { ProductVisualization } from "../ar/assets.ts";
export type MenuCategory = { id: string; name: string; description: string };
export type ModifierOption = {
  id: string;
  name: string;
  priceAdjustmentMinor: number;
};
export type ModifierGroup = {
  id: string;
  name: string;
  description: string;
  selectionType: "single" | "multiple";
  minSelections: number;
  maxSelections: number;
  options: ModifierOption[];
};
export type MenuProduct = {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  priceMinor: number;
  image?: string;
  imageAlt: string;
  tags: string[];
  ingredients: string[];
  allergens: string[];
  modifierGroups: ModifierGroup[];
  visualization?: ProductVisualization;
};

export type RestaurantMenu = {
  id: string;
  slug: string;
  name: string;
  location?: string;
  description?: string;
  coverImage?: string;
  logoImage?: string;
  currency: string;
  isAcceptingOrders: boolean;
  categories: MenuCategory[];
  products: MenuProduct[];
};

export type TableContext =
  | { status: "valid"; label: string; token: string; visitKey: string }
  | { status: "missing" | "invalid" };

export type CustomerContext = {
  mode: "demo" | "live";
  restaurant: Omit<RestaurantMenu, "categories" | "products">;
  table: TableContext;
};
