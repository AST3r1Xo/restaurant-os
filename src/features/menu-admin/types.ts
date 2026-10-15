import type { Database } from "@/types/database";
type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type MediaAsset = Row<"menu_media_assets">;
export type Category = Row<"menu_categories">;
export type ModifierOption = Row<"modifier_options">;
export type ModifierGroup = Row<"product_modifier_groups"> & {
  options: ModifierOption[];
};
export type ModelReview = {
  license: string;
  provenance: string;
  measurement_notes: string;
  confirmed?: boolean;
};
export type AdminProduct = Row<"products"> & {
  groups: ModifierGroup[];
  review: ModelReview | null;
};
export type MenuWorkspace = {
  restaurant: Row<"restaurants">;
  categories: Category[];
  products: AdminProduct[];
  assets: MediaAsset[];
};
export type ProductDefinition = {
  name: string;
  description: string;
  category_id: string;
  price_minor: number;
  ingredients: string[];
  allergens: string[];
  dietary_tags: string[];
  is_available: boolean;
  status: "draft" | "published" | "archived";
  keep_legacy_image: boolean;
  image_asset_id: string | null;
  model_asset_id: string | null;
  model_usdz_asset_id: string | null;
  model_poster_asset_id: string | null;
  model_verified: boolean;
  model_ar_enabled: boolean;
  review: ModelReview;
  groups: {
    id: string;
    name: string;
    description: string;
    selection_type: "single" | "multiple";
    min_selections: number;
    max_selections: number;
    is_active: boolean;
    options: {
      id: string;
      name: string;
      price_adjustment_minor: number;
      is_available: boolean;
    }[];
  }[];
};
export type AdminResult<T = object> =
  { ok: true; data: T } | { ok: false; message: string };
