import { supabase } from "../supabase.js";

export async function listTransactions() {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, holding_id, type, quantity, price, date, fee, created_at")
    .order("date", { ascending: false });
  if (error) throw error;
  // client 측 호환을 위해 holdingId 별칭 추가
  return data.map((t) => ({ ...t, holdingId: t.holding_id }));
}

export async function addTransaction({ holdingId, type, quantity, price, date, fee = 0 }) {
  const { data, error } = await supabase
    .from("transactions")
    .insert({ holding_id: holdingId, type, quantity, price, date, fee })
    .select()
    .single();
  if (error) throw error;
  return { ...data, holdingId: data.holding_id };
}

export async function updateTransaction(id, patch) {
  const dbPatch = {
    ...(patch.type !== undefined && { type: patch.type }),
    ...(patch.quantity !== undefined && { quantity: patch.quantity }),
    ...(patch.price !== undefined && { price: patch.price }),
    ...(patch.date !== undefined && { date: patch.date }),
    ...(patch.fee !== undefined && { fee: patch.fee }),
  };
  const { data, error } = await supabase
    .from("transactions").update(dbPatch).eq("id", id).select().single();
  if (error) throw error;
  return { ...data, holdingId: data.holding_id };
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw error;
}
