// Shapes shared by the local store and (in phase 2) the Supabase store.
// They mirror the tables in supabase/migrations.

export type CardType = "raw" | "slab";
export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "SGC"] as const;
export type GradingCompany = (typeof GRADING_COMPANIES)[number];

export interface Folder {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Card {
  id: string;
  folder_id: string;
  type: CardType;
  name: string;
  card_number: string;
  game: string;
  language: string;
  condition: Condition | null;
  grading_company: GradingCompany | null;
  grade: number | null;
  cert_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface Purchase {
  id: string;
  card_id: string;
  buy_date: string; // YYYY-MM-DD
  buy_price: number; // market value per card, USD
  buy_percentage: number; // percent of market paid
  quantity: number;
  created_at: string;
  updated_at: string;
}

export interface Sale {
  id: string;
  card_id: string;
  sell_date: string; // YYYY-MM-DD
  sell_price: number; // market value per card, USD
  sell_percentage: number; // percent of market received
  sell_quantity: number;
  created_at: string;
  updated_at: string;
}

export interface CardSummary extends Card {
  copies_bought: number;
  copies_sold: number;
  quantity_owned: number;
  total_cost: number;
  average_cost: number;
  total_received: number;
  realized_profit: number;
}

export type NewFolder = { name: string; description?: string | null };

export type NewCard =
  | {
      type: "raw";
      folder_id: string;
      name: string;
      card_number: string;
      condition: Condition;
    }
  | {
      type: "slab";
      folder_id: string;
      name: string;
      card_number: string;
      grading_company: GradingCompany;
      grade: number;
      cert_number: string;
    };

export type NewPurchase = Pick<
  Purchase,
  "card_id" | "buy_date" | "buy_price" | "buy_percentage" | "quantity"
>;
export type NewSale = Pick<
  Sale,
  "card_id" | "sell_date" | "sell_price" | "sell_percentage" | "sell_quantity"
>;
