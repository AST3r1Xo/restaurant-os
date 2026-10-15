import type { RestaurantMenu } from "./types";

// Presentation fixtures only. Never use these as a fallback for failed live queries.
export const demoMenu: RestaurantMenu = {
  id: "demo-mesa",
  slug: "mesa",
  name: "Casa Mesa",
  location: "Lisbon, Portugal",
  currency: "EUR",
  isAcceptingOrders: true,
  description:
    "Welcome to our table. Explore a menu inspired by the season, the neighborhood, and the joy of sharing a meal.",
  coverImage: "/images/restaurant.jpg",
  categories: [
    {
      id: "favorites",
      name: "House favorites",
      description: "The dishes we come back to. And think you will, too.",
    },
    {
      id: "starters",
      name: "To begin",
      description: "A good meal starts with something to share.",
    },
    {
      id: "mains",
      name: "From the kitchen",
      description: "Seasonal ingredients. A little care. A lot of flavor.",
    },
    {
      id: "desserts",
      name: "Something sweet",
      description: "Leave a little room for a lovely finish.",
    },
    {
      id: "drinks",
      name: "In your glass",
      description: "Something refreshing to accompany your meal.",
    },
  ],
  products: [
    {
      id: "eggs",
      visualization: {
        src: "/models/demo-mesa/eggs/avocado.glb",
        poster: "/models/demo-mesa/eggs/avocado-poster.jpg",
        alt: "Development ingredient study: a cut avocado with its stone and textured skin. This is not a model of the salmon eggs or a restaurant portion.",
        dimensions: [0.06767, 0.04391, 0.1],
        development: {
          label:
            "Avocado ingredient study · not this dish or a portion preview",
          attribution:
            "Avocado by Microsoft · CC0. Optimized and reoriented for this demonstration.",
          source:
            "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Avocado",
        },
      },
      ingredients: ["Poached eggs", "Smoked salmon", "Hollandaise", "Brioche"],
      allergens: ["Milk", "Wheat", "Egg", "Fish"],
      modifierGroups: [
        {
          id: "eggs-base",
          name: "Your bread",
          description: "Choose your favorite.",
          selectionType: "single",
          minSelections: 1,
          maxSelections: 1,
          options: [
            {
              id: "eggs-base-0",
              name: "Toasted brioche",
              priceAdjustmentMinor: 0,
            },
            { id: "eggs-base-1", name: "Sourdough", priceAdjustmentMinor: 0 },
          ],
        },
        {
          id: "eggs-extras",
          name: "A little extra",
          description: "Optional additions, made for you.",
          selectionType: "multiple",
          minSelections: 0,
          maxSelections: 2,
          options: [
            { id: "eggs-extra-0", name: "Avocado", priceAdjustmentMinor: 250 },
            {
              id: "eggs-extra-1",
              name: "Extra poached egg",
              priceAdjustmentMinor: 200,
            },
            {
              id: "eggs-extra-2",
              name: "No hollandaise",
              priceAdjustmentMinor: 0,
            },
          ],
        },
      ],
      categoryId: "starters",
      name: "Smoked salmon eggs",
      description:
        "Poached eggs, smoked salmon, hollandaise & toasted brioche.",
      priceMinor: 1400,
      image: "/images/eggs.jpg",
      imageAlt: "Poached eggs and smoked salmon on toast with hollandaise",
      tags: ["House favorite", "Chef’s selection"],
    },
    {
      id: "pasta",
      ingredients: ["Fresh pasta", "Tomatoes", "Basil", "Parmesan"],
      allergens: ["Milk", "Wheat", "Egg"],
      modifierGroups: [
        {
          id: "pasta-base",
          name: "Your sauce",
          description: "Choose your favorite.",
          selectionType: "single",
          minSelections: 1,
          maxSelections: 1,
          options: [
            {
              id: "pasta-base-0",
              name: "Tomato & basil",
              priceAdjustmentMinor: 0,
            },
            { id: "pasta-base-1", name: "Arrabbiata", priceAdjustmentMinor: 0 },
          ],
        },
        {
          id: "pasta-extras",
          name: "Finishing touches",
          description: "Optional additions, made for you.",
          selectionType: "multiple",
          minSelections: 0,
          maxSelections: 2,
          options: [
            {
              id: "pasta-extra-0",
              name: "Extra Parmesan",
              priceAdjustmentMinor: 150,
            },
            {
              id: "pasta-extra-1",
              name: "Toasted pine nuts",
              priceAdjustmentMinor: 200,
            },
            {
              id: "pasta-extra-2",
              name: "No Parmesan",
              priceAdjustmentMinor: 0,
            },
          ],
        },
      ],
      categoryId: "mains",
      name: "Basil & tomato pasta",
      description: "Fresh pasta, slow-roasted tomatoes, basil & aged Parmesan.",
      priceMinor: 2200,
      image: "/images/pasta.jpg",
      imageAlt: "A plate of fresh tomato pasta with basil",
      tags: ["House favorite", "Vegetarian"],
    },
    {
      id: "salad",
      ingredients: [
        "Market greens",
        "Roasted vegetables",
        "Grains",
        "Lemon dressing",
      ],
      allergens: [],
      modifierGroups: [
        {
          id: "salad-base",
          name: "Your dressing",
          description: "Choose your favorite.",
          selectionType: "single",
          minSelections: 1,
          maxSelections: 1,
          options: [
            {
              id: "salad-base-0",
              name: "Lemon dressing",
              priceAdjustmentMinor: 0,
            },
            {
              id: "salad-base-1",
              name: "Tahini dressing",
              priceAdjustmentMinor: 0,
            },
          ],
        },
        {
          id: "salad-extras",
          name: "Make it yours",
          description: "Optional additions, made for you.",
          selectionType: "multiple",
          minSelections: 0,
          maxSelections: 2,
          options: [
            { id: "salad-extra-0", name: "Avocado", priceAdjustmentMinor: 250 },
            {
              id: "salad-extra-1",
              name: "Toasted seeds",
              priceAdjustmentMinor: 150,
            },
          ],
        },
      ],
      categoryId: "mains",
      name: "Seasonal garden bowl",
      description:
        "Market greens, roasted vegetables, grains & lemon dressing.",
      priceMinor: 1800,
      image: "/images/salad.jpg",
      imageAlt: "A colorful bowl of fresh seasonal greens and vegetables",
      tags: ["House favorite", "Plant based"],
    },
  ],
};
