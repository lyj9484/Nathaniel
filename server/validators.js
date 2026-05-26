import { z } from "zod";

export const StockSymbolSchema = z
  .string()
  .min(1)
  .max(15)
  .regex(/^[A-Z0-9.\-]+$/, "invalid symbol");

export const CategorySchema = z.enum(["kr", "us", "crypto"]);

export const HoldingSummarySchema = z.object({
  symbol: StockSymbolSchema,
  name: z.string().max(50),
  category: CategorySchema,
});

export const NewsBodySchema = z.object({
  holdings: z.array(HoldingSummarySchema).max(50),
});

export const StockAnalysisBodySchema = z.object({
  name: z.string().max(50).optional(),
  category: CategorySchema.optional(),
  currentPrice: z.number().positive().nullable().optional(),
  avgPrice: z.number().nonnegative().nullable().optional(),
  quantity: z.number().nonnegative().nullable().optional(),
});
