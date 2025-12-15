// app/utils/currencyStore.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

export type CurrencyCode = "MYR" | "SGD" | "USD" | "CNY";

export const CURRENCY_OPTIONS: {
  code: CurrencyCode;
  symbol: string;
  label: string;
}[] = [
  { code: "MYR", symbol: "RM", label: "RM (MYR)" },
  { code: "SGD", symbol: "S$", label: "S$ (SGD)" },
  { code: "USD", symbol: "$", label: "$ (USD)" },
  { code: "CNY", symbol: "¥", label: "¥ (CNY)" },
];

const KEY = "fintrack_currency_code_v1";

export async function getCurrencyCode(): Promise<CurrencyCode> {
  const v = await AsyncStorage.getItem(KEY);
  if (v === "MYR" || v === "SGD" || v === "USD" || v === "CNY") return v;
  return "MYR"; // default
}

export async function setCurrencyCode(code: CurrencyCode): Promise<void> {
  await AsyncStorage.setItem(KEY, code);
}

export function codeToSymbol(code: CurrencyCode): string {
  const found = CURRENCY_OPTIONS.find((c) => c.code === code);
  return found?.symbol ?? "RM";
}

export function codeToLabel(code: CurrencyCode): string {
  const found = CURRENCY_OPTIONS.find((c) => c.code === code);
  return found?.label ?? "RM (MYR)";
}
